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

test("export -> import round trip creates a separate session that restores", async ({ context, worker, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`${SITE}/gamma`);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const saved = await manager.evaluate(() => chrome.runtime.sendMessage({ type: "session.capture", scope: { kind: "all-windows" } }));
  expect(saved).toMatchObject({ ok: true });

  await manager.getByRole("button", { name: /all windows,/i }).click();
  const downloadPromise = manager.waitForEvent("download");
  await manager.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^sessionhub-all-windows-.*\.json$/);
  const exportPath = await download.path();

  await manager.getByLabel("Import a SessionHub export file").setInputFiles(exportPath);
  const dialog = manager.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Import session" })).toBeVisible();
  await dialog.getByRole("button", { name: "Import session" }).click();

  const inspector = manager.getByRole("article", { name: /session details/i });
  await expect(inspector.getByText(/imported from this browser/i)).toBeVisible();
  await expect(manager.getByRole("button", { name: /all windows,/i })).toHaveCount(2);
  const ids = await manager.evaluate(async () => {
    const request = indexedDB.open("sessionhub");
    const db = await new Promise<IDBDatabase>((resolve) => (request.onsuccess = () => resolve(request.result)));
    const all = await new Promise<{ id: string }[]>((resolve) => {
      const get = db.transaction("sessions").objectStore("sessions").getAll();
      get.onsuccess = () => resolve(get.result);
    });
    return all.map((session) => session.id);
  });
  expect(new Set(ids).size).toBe(2);

  const before = await snapshotWindows(worker);
  await inspector.getByRole("button", { name: /restore/i }).click();
  await manager.getByRole("dialog").getByRole("button", { name: /^restore 1 tab$/i }).click();
  await expect(manager.getByRole("dialog").getByText(/opened 1 of 1 tab/i)).toBeVisible();
  await expect
    .poll(async () => (await snapshotWindows(worker)).windows.find((window) => !before.windows.some((old) => old.id === window.id))?.urls)
    .toEqual([`${SITE}/gamma`]);
});

test("retry reopens only the failed tab, in a new window, and only once", async ({ context, worker, extensionId }) => {
  for (const name of ["one", "two", "three"]) await (await context.newPage()).goto(`${SITE}/${name}`);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const saved = await manager.evaluate(() => chrome.runtime.sendMessage({ type: "session.capture", scope: { kind: "all-windows" } }));
  const restored = await manager.evaluate(
    (sessionId) => chrome.runtime.sendMessage({ type: "restore.start", sessionId }),
    (saved as { data: { sessionId: string } }).data.sessionId,
  );
  const jobId = (restored as { data: { job: { id: string } } }).data.job.id;

  // Simulate "two" having failed (e.g. its window was closed mid-restore).
  await manager.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("sessionhub");
      request.onsuccess = () => resolve(request.result);
    });
    const store = db.transaction("restoreJobs", "readwrite").objectStore("restoreJobs");
    const job = await new Promise<{ status: string; plan: { windows: { tabs: { sourceTabId: string; url: string }[] }[] }; outcomes: { sourceTabId: string; status: string; error?: string }[] }>(
      (resolve) => {
        const get = store.get(id);
        get.onsuccess = () => resolve(get.result);
      },
    );
    const two = job.plan.windows.flatMap((w) => w.tabs).find((tab) => tab.url.endsWith("/two"))!;
    job.outcomes = job.outcomes.map((o) => (o.sourceTabId === two.sourceTabId ? { sourceTabId: o.sourceTabId, status: "failed", error: "closed" } : o));
    job.status = "partial";
    await new Promise((resolve) => (store.put(job).onsuccess = resolve));
  }, jobId);

  const countUrl = async (url: string) => (await snapshotWindows(worker)).windows.flatMap((w) => w.urls).filter((u) => u === url).length;
  await expect.poll(() => countUrl(`${SITE}/one`)).toBe(2); // original tab + first restore
  const before = await snapshotWindows(worker);

  const retried = await manager.evaluate((id) => chrome.runtime.sendMessage({ type: "restore.retry", jobId: id }), jobId);
  expect(retried).toMatchObject({ ok: true, data: { job: { status: "completed", attempts: 2 } } });
  await expect
    .poll(async () => (await snapshotWindows(worker)).windows.find((w) => !before.windows.some((old) => old.id === w.id))?.urls)
    .toEqual([`${SITE}/two`]);
  expect(await countUrl(`${SITE}/one`)).toBe(2);
  expect(await countUrl(`${SITE}/three`)).toBe(2);

  const again = await manager.evaluate((id) => chrome.runtime.sendMessage({ type: "restore.retry", jobId: id }), jobId);
  expect(again).toMatchObject({ ok: false, error: { code: "conflict" } });
});

test("a real mid-restore failure can be retried from the summary", async ({ context, worker, extensionId }) => {
  for (const name of ["red", "green", "blue"]) await (await context.newPage()).goto(`${SITE}/${name}`);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const saved = await manager.evaluate(() => chrome.runtime.sendMessage({ type: "session.capture", scope: { kind: "all-windows" } }));
  const sessionId = (saved as { data: { sessionId: string } }).data.sessionId;

  // Close every new window as soon as Chrome creates it: like a user closing the
  // restored window mid-restore, later tabs.create calls fail for real.
  await worker.evaluate(() => {
    const closer = (window: { id?: number }) => void chrome.windows.remove(window.id!);
    (globalThis as unknown as { closer: typeof closer }).closer = closer;
    chrome.windows.onCreated.addListener(closer);
  });
  await manager.goto(`chrome-extension://${extensionId}/manager.html#session=${sessionId}`);
  await manager.getByRole("button", { name: /restore/i }).click();
  const dialog = manager.getByRole("dialog");
  await dialog.getByRole("button", { name: /^restore 3 tabs$/i }).click();
  await expect(dialog.getByText(/the window was closed before this tab could open/i).first()).toBeVisible();
  const retryButton = dialog.getByRole("button", { name: /^retry \d+ tabs?$/i });
  await expect(retryButton).toBeVisible();
  const failedCount = Number((await retryButton.textContent())?.match(/\d+/)?.[0]);

  await worker.evaluate(() =>
    chrome.windows.onCreated.removeListener((globalThis as unknown as { closer: (w: { id?: number }) => void }).closer),
  );
  const before = await snapshotWindows(worker);
  await retryButton.click();
  await expect(dialog.getByText(/opened 3 of 3 tabs after 2 attempts/i)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^retry/i })).toHaveCount(0);

  // Only the tabs that failed were reopened, in one new window.
  const created = (await snapshotWindows(worker)).windows.filter((w) => !before.windows.some((old) => old.id === w.id));
  expect(created).toHaveLength(1);
  const reopened = created[0]!.urls;
  expect(reopened).toHaveLength(failedCount);
  expect(reopened.every((url) => [`${SITE}/red`, `${SITE}/green`, `${SITE}/blue`].includes(url))).toBe(true);
});

/** Reads a whole object store from the extension's IndexedDB (runs in the page; pass the name as the evaluate argument). */
const readStore = async (store: "recoverySnapshots" | "recoveryState") => {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open("sessionhub");
    request.onsuccess = () => resolve(request.result);
  });
  return new Promise<unknown[]>((resolve) => {
    const get = db.transaction(store).objectStore(store).getAll();
    get.onsuccess = () => resolve(get.result);
  });
};

test("browser changes trigger an automatic checkpoint via a real alarm, restorable from Recovery", async ({ context, worker, extensionId }) => {
  test.setTimeout(150_000);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html#view=recovery`);
  await expect(manager.getByText(/automatic checkpoints appear as you browse/i)).toBeVisible();

  const page = await context.newPage();
  await page.goto(`${SITE}/checkpoint-me`);
  // The change is recorded durably and a debounce alarm is armed.
  await expect
    .poll(async () => ((await manager.evaluate(readStore, "recoveryState" as const)) as { dirty: boolean }[])[0]?.dirty)
    .toBe(true);
  expect(await worker.evaluate(() => chrome.alarms.get("recovery-debounce").then((alarm) => Boolean(alarm)))).toBe(true);
  expect(await worker.evaluate(() => chrome.alarms.get("recovery-periodic").then((alarm) => alarm?.periodInMinutes))).toBe(30);

  // Chrome fires the 30s debounce alarm; the open Recovery view updates live.
  const today = manager.getByRole("region", { name: "Today" });
  await expect(today.getByRole("button")).toHaveCount(1, { timeout: 100_000 });
  const snapshots = (await manager.evaluate(readStore, "recoverySnapshots" as const)) as {
    reason: string;
    session: { windows: { tabs: { url: string }[] }[] };
  }[];
  expect(snapshots[0]!.reason).toBe("automatic");
  const urls = snapshots[0]!.session.windows.flatMap((w) => w.tabs.map((t) => t.url));
  expect(urls).toContain(`${SITE}/checkpoint-me`);
  // SessionHub's own manager page is never captured.
  expect(urls.some((url) => url.startsWith(`chrome-extension://${extensionId}`))).toBe(false);
  expect(((await manager.evaluate(readStore, "recoveryState" as const)) as { dirty: boolean }[])[0]?.dirty).toBe(false);

  // Restore it into a new window from the Recovery inspector.
  await page.close();
  const before = await snapshotWindows(worker);
  await today.getByRole("button").click();
  await manager.getByRole("article", { name: /checkpoint details/i }).getByRole("button", { name: /restore/i }).click();
  const dialog = manager.getByRole("dialog");
  await dialog.getByRole("button", { name: /^restore 1 tab$/i }).click();
  await expect(dialog.getByText(/opened 1 of 1 tab/i)).toBeVisible();
  await expect
    .poll(async () => (await snapshotWindows(worker)).windows.find((w) => !before.windows.some((old) => old.id === w.id))?.urls)
    .toEqual([`${SITE}/checkpoint-me`]);
});

test("Checkpoint now skips unchanged state", async ({ context, extensionId }) => {
  await (await context.newPage()).goto(`${SITE}/steady`);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html#view=recovery`);
  await manager.getByRole("button", { name: "Checkpoint now" }).click();
  await expect(manager.getByText("Checkpoint saved.")).toBeVisible();
  await manager.getByRole("button", { name: "Checkpoint now" }).click();
  await expect(manager.getByText(/nothing changed since the last checkpoint/i)).toBeVisible();
  await expect(manager.getByRole("region", { name: "Today" }).getByRole("button")).toHaveCount(1);
});

