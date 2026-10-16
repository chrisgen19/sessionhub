import type { Worker } from "@playwright/test";
import type { browser } from "wxt/browser";
import { expect, getServiceWorker, launchWithExtension, SITE, test } from "./fixtures";

// The extension's `chrome` global inside worker.evaluate().
declare const chrome: typeof browser;

const snapshotWindows = (worker: Worker) =>
  worker.evaluate(async () => {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    const groups = await chrome.tabGroups.query({});
    return {
      windows: windows.map((window) => ({
        id: window.id,
        urls: (window.tabs ?? []).map((tab) => tab.url ?? tab.pendingUrl ?? ""),
        pinned: (window.tabs ?? []).filter((tab) => tab.pinned).map((tab) => tab.url ?? tab.pendingUrl ?? ""),
      })),
      groupTitles: groups.map((group) => group.title),
    };
  });

test("capture -> IndexedDB -> list -> restore into a new window, leaving existing tabs alone", async ({
  context,
  worker,
  extensionId,
}) => {
  const pageA = await context.newPage();
  await pageA.goto(`${SITE}/alpha`);
  const pageB = await context.newPage();
  await pageB.goto(`${SITE}/beta`);
  await worker.evaluate(async (site) => {
    const [beta] = await chrome.tabs.query({ url: `${site}/beta` });
    const groupId = await chrome.tabs.group({ tabIds: [beta!.id!] });
    await chrome.tabGroups.update(groupId, { title: "Research", color: "green" });
    const [alpha] = await chrome.tabs.query({ url: `${site}/alpha` });
    await chrome.tabs.update(alpha!.id!, { pinned: true });
  }, SITE);

  // Save from the real popup UI.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole("button", { name: /save all/i }).click();
  await expect(popup.getByText(/saved locally/i)).toBeVisible();
  // The popup list updates from IndexedDB written by the background worker.
  await expect(popup.getByRole("button", { name: /all windows,/i })).toBeVisible();
  await popup.close();

  const before = await snapshotWindows(worker);

  // Find and restore it from the manager.
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  await manager.getByRole("searchbox").fill("beta");
  await manager.getByRole("button", { name: /all windows,/i }).click();
  const inspector = manager.getByRole("article", { name: /session details/i });
  await expect(inspector.getByText("Page beta").first()).toBeVisible();
  await expect(inspector.getByText("Research")).toBeVisible();

  await inspector.getByRole("button", { name: /restore/i }).click();
  const dialog = manager.getByRole("dialog");
  await expect(dialog.getByText(/opens in new windows/i)).toBeVisible();
  // about:blank and the extension pages themselves are saved as reference only.
  await expect(dialog.getByText(/can't be restored/i)).toBeVisible();
  await dialog.getByRole("button", { name: /^restore 2 tabs$/i }).click();
  await expect(dialog.getByText(/opened 2 of 2 tabs in 1 new window/i)).toBeVisible();

  const isNew = (window: { id?: number }) => !before.windows.some((old) => old.id === window.id);
  // New tabs report an empty url until navigation commits, so poll.
  await expect
    .poll(async () => (await snapshotWindows(worker)).windows.find(isNew)?.urls)
    .toEqual([`${SITE}/alpha`, `${SITE}/beta`]);
  const after = await snapshotWindows(worker);
  expect(after.windows).toHaveLength(before.windows.length + 1);
  const created = after.windows.find(isNew);
  expect(created?.pinned).toEqual([`${SITE}/alpha`]);
  expect(after.groupTitles.filter((title) => title === "Research")).toHaveLength(2);
  // Original tabs are untouched.
  for (const window of before.windows) {
    expect(after.windows.find((candidate) => candidate.id === window.id)?.urls).toEqual(
      expect.arrayContaining(window.urls.filter((url) => url.startsWith(SITE))),
    );
  }
});

test("saved sessions survive a service-worker stop and a browser restart", async ({ context, extensionId, userDataDir }) => {
  const page = await context.newPage();
  await page.goto(`${SITE}/persist`);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const response = await manager.evaluate(() =>
    chrome.runtime.sendMessage({ type: "session.capture", scope: { kind: "all-windows" } }),
  );
  expect(response).toMatchObject({ ok: true });

  // Force-stop the MV3 worker via CDP and wait until Chrome reports it stopped; the next
  // command must restart it and still work from durable IndexedDB state.
  const cdp = await context.newCDPSession(manager);
  const statuses: string[] = [];
  cdp.on("ServiceWorker.workerVersionUpdated", (event) => statuses.push(...event.versions.map((version) => version.runningStatus)));
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await expect.poll(() => statuses.at(-1)).toBe("stopped");
  const second = await manager.evaluate(() => chrome.runtime.sendMessage({ type: "session.capture", scope: { kind: "all-windows" } }));
  expect(second).toMatchObject({ ok: true });
  expect(statuses.slice(statuses.lastIndexOf("stopped"))).toContain("running");
  await expect(manager.getByRole("button", { name: /all windows,/i })).toHaveCount(2);

  // Restart the browser with the same profile.
  await context.close();
  const reopened = await launchWithExtension(userDataDir);
  try {
    const restartedWorker = await getServiceWorker(reopened);
    const id = new URL(restartedWorker.url()).host;
    const again = await reopened.newPage();
    await again.goto(`chrome-extension://${id}/manager.html`);
    await expect(again.getByRole("button", { name: /all windows,/i })).toHaveCount(2);
  } finally {
    await reopened.close();
  }
});

test("rejects malformed commands", async ({ context, extensionId }) => {
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const result = await manager.evaluate(() => chrome.runtime.sendMessage({ type: "tabs.closeAll" }));
  expect(result).toMatchObject({ ok: false, error: { code: "invalid-command" } });
});
