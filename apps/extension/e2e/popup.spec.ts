import type { Page } from "@playwright/test";
import type { browser } from "wxt/browser";
import { expect, test } from "./fixtures";
import { openWindow, readWindow, saveTabs, send, windowIds } from "./window-helpers";

// The extension's `chrome` global inside evaluate().
declare const chrome: typeof browser;

/** The popup document against Chrome's 600 px popup limit: only its middle area may scroll. */
const measure = (popup: Page) =>
  popup.evaluate(() => {
    const root = document.getElementById("root")!.firstElementChild!;
    const main = document.querySelector("main")!;
    return {
      rootHeight: root.getBoundingClientRect().height,
      pageOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      mainScrolls: main.scrollHeight > main.clientHeight,
    };
  });

test("the popup fits Chrome's 600 px limit on both tabs: one scroll area and no empty space below it", async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  // Browser pages in the popup's own window (their badges once stretched the popup, PR #35), and 20 sessions.
  await popup.evaluate(async () => {
    const { id } = await chrome.windows.getCurrent();
    for (const url of ["chrome://version/", "chrome://settings/", "chrome://extensions/", "chrome://history/", "chrome://downloads/", "chrome://about/", ...Array<string>(8).fill("chrome://newtab/")]) {
      await chrome.tabs.create({ windowId: id, url, active: false });
    }
  });
  for (let index = 1; index <= 20; index += 1) {
    expect(await send(popup, { type: "session.capture", scope: { kind: "all-windows" }, name: `Research ${index}` })).toMatchObject({ ok: true });
  }

  await popup.reload();
  await expect(popup.getByRole("button", { name: /^Research 20/ })).toBeVisible();
  const open = await measure(popup);
  expect(open.rootHeight).toBeLessThanOrEqual(600);
  expect(open).toMatchObject({ pageOverflow: 0, mainScrolls: true });

  await popup.getByRole("tab", { name: "Save" }).click();
  await expect(popup.getByText("Won't reopen").first()).toBeVisible();
  const save = await measure(popup);
  expect(save.rootHeight).toBeLessThanOrEqual(600);
  expect(save).toMatchObject({ pageOverflow: 0, mainScrolls: true });
});

test("tap a session in the popup, untick a tab, and open the rest in the popup's own window", async ({ worker, context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const saved = await openWindow(worker, { pages: ["p-one", "p-two", "p-three"] });
  await saveTabs(worker, popup, [saved]);
  const popupWindow = (await popup.evaluate(() => chrome.windows.getCurrent())).id!;
  await popup.reload();

  await popup.getByRole("button", { name: /^Window,/ }).click();
  const panel = popup.getByRole("region", { name: "Open tabs" });
  await panel.getByRole("checkbox", { name: /p-two/ }).uncheck();
  await panel.getByRole("button", { name: "Choose where to open" }).click();
  await popup.getByRole("menuitemradio", { name: "This window" }).click();
  const before = await readWindow(worker, popupWindow);
  await panel.getByRole("button", { name: "Open 2 tabs in this window" }).click();
  await expect(panel.getByText("Opened 2 of 2 tabs in this window.")).toBeVisible();

  await expect.poll(() => readWindow(worker, popupWindow)).toEqual([
    ...before,
    { page: "p-one", pinned: false, group: null },
    { page: "p-three", pinned: false, group: null },
  ]);
});

test("closing the popup right after Open doesn't stop the restore: the worker finishes it", async ({ worker, context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const pages = Array.from({ length: 8 }, (_, index) => `closing-${index}`);
  const saved = await openWindow(worker, { pages });
  await saveTabs(worker, popup, [saved]);
  await popup.reload();
  const windowsBefore = await windowIds(worker);

  // A real popup closes as soon as the new window takes focus; here the page is closed straight away.
  await popup.getByRole("button", { name: /^Open "Window, .*" \(8 tabs\) in 1 new window$/ }).click();
  await popup.close();

  await expect
    .poll(async () => {
      const added = (await windowIds(worker)).filter((id) => !windowsBefore.includes(id));
      return added.length === 1 ? (await readWindow(worker, added[0]!)).map((tab) => tab.page) : [];
    })
    .toEqual(pages);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  await expect
    .poll(() =>
      manager.evaluate(
        () =>
          new Promise<string[]>((resolve) => {
            const request = indexedDB.open("sessionhub");
            request.onsuccess = () => {
              const all = request.result.transaction("restoreJobs").objectStore("restoreJobs").getAll();
              all.onsuccess = () => resolve((all.result as { status: string }[]).map((job) => job.status));
            };
          }),
      ),
    )
    .toEqual(["completed"]);
});
