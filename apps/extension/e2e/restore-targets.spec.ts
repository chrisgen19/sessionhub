import type { Page, Worker } from "@playwright/test";
import type { browser } from "wxt/browser";
import { expect, SITE, test } from "./fixtures";

// The extension's `chrome` global inside evaluate().
declare const chrome: typeof browser;

interface WindowSpec {
  /** Page names served by the fixture site, in tab order. */
  pages: string[];
  pinned?: string[];
  group?: { title: string; pages: string[] };
}

/** Opens a normal window with these pages, pinned tabs and one named group; returns its id and tab ids. */
const openWindow = (worker: Worker, spec: WindowSpec) =>
  worker.evaluate(
    async ({ site, spec }) => {
      const window = await chrome.windows.create({ url: spec.pages.map((page) => `${site}/${page}`) });
      const tabs = window!.tabs!;
      const idOf = (page: string) => tabs[spec.pages.indexOf(page)]!.id!;
      for (const page of spec.pinned ?? []) await chrome.tabs.update(idOf(page), { pinned: true });
      if (spec.group) {
        const tabIds = spec.group.pages.map(idOf) as [number, ...number[]];
        const groupId = (await chrome.tabs.group({ tabIds, createProperties: { windowId: window!.id! } })) as number;
        await chrome.tabGroups.update(groupId, { title: spec.group.title, color: "blue" });
      }
      return { windowId: window!.id!, tabIds: tabs.map((tab) => tab.id!) };
    },
    { site: SITE, spec },
  );

/** A window's tabs in strip order: page name, pinned, and its group's title. */
const readWindow = (worker: Worker, windowId: number) =>
  worker.evaluate(
    async ({ site, windowId }) => {
      const tabs = await chrome.tabs.query({ windowId });
      const groups = new Map((await chrome.tabGroups.query({ windowId })).map((group) => [group.id, group.title]));
      return tabs
        .sort((a, b) => a.index - b.index)
        .map((tab) => ({
          page: (tab.url || tab.pendingUrl || "").replace(`${site}/`, ""),
          pinned: tab.pinned,
          group: tab.groupId === -1 ? null : (groups.get(tab.groupId) ?? "untitled"),
        }));
    },
    { site: SITE, windowId },
  );

const windowIds = (worker: Worker) => worker.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ["normal"] })).map((window) => window.id!));

const send = (page: Page, message: unknown) => page.evaluate((message) => chrome.runtime.sendMessage(message), message);

const countRestoreJobs = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open("sessionhub");
        request.onsuccess = () => {
          const count = request.result.transaction("restoreJobs").objectStore("restoreJobs").count();
          count.onsuccess = () => resolve(count.result);
        };
      }),
  );

/** True once every tab in the window has finished loading with a committed URL. */
const loaded = (worker: Worker, windowId: number) =>
  worker.evaluate(async (windowId) => (await chrome.tabs.query({ windowId })).every((tab) => tab.status === "complete" && tab.url !== ""), windowId);

/** Saves exactly these tabs once they have loaded: mid-navigation, a tab's url and pendingUrl can both be empty. */
const saveTabs = async (worker: Worker, manager: Page, windows: { windowId: number; tabIds: number[] }[]) => {
  for (const { windowId, tabIds } of windows) {
    await expect.poll(() => loaded(worker, windowId)).toBe(true);
    expect(tabIds.length).toBeGreaterThan(0);
  }
  const saved = await send(manager, { type: "session.capture", scope: { kind: "tabs", tabIds: windows.flatMap((window) => window.tabIds) } });
  expect(saved).toMatchObject({ ok: true });
  return (saved as { data: { sessionId: string } }).data.sessionId;
};

test("this window: appends after its tabs, skips ones already open, and keeps its own groups and order", async ({ worker, context, extensionId }) => {
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const saved = await openWindow(worker, {
    pages: ["pin", "existing", "grouped-a", "grouped-b", "plain-last"],
    pinned: ["pin"],
    group: { title: "Saved", pages: ["grouped-a", "grouped-b"] },
  });
  const sessionId = await saveTabs(worker, manager, [saved]);
  // The target window's last tab is in a group, the case where an appended tab could join it.
  const target = await openWindow(worker, { pages: ["a-pin", "existing", "a-last"], pinned: ["a-pin"], group: { title: "Existing", pages: ["a-last"] } });
  await expect.poll(async () => (await readWindow(worker, target.windowId)).every((tab) => tab.page !== "")).toBe(true);
  const windowsBefore = await windowIds(worker);

  const response = await send(manager, { type: "restore.start", sessionId, target: { kind: "this-window", windowId: target.windowId, skipOpen: true } });
  expect(response).toMatchObject({ ok: true, data: { job: { status: "completed", target: "this-window", plan: { tabCount: 4 } } } });
  expect((response as { data: { job: { plan: { alreadyOpen: { url: string }[] } } } }).data.job.plan.alreadyOpen.map((tab) => tab.url)).toEqual([`${SITE}/existing`]);

  expect(await windowIds(worker)).toEqual(windowsBefore);
  await expect.poll(() => readWindow(worker, target.windowId)).toEqual([
    { page: "a-pin", pinned: true, group: null },
    { page: "pin", pinned: true, group: null },
    { page: "existing", pinned: false, group: null },
    { page: "a-last", pinned: false, group: "Existing" },
    { page: "grouped-a", pinned: false, group: "Saved" },
    { page: "grouped-b", pinned: false, group: "Saved" },
    { page: "plain-last", pinned: false, group: null },
  ]);
});

test("one new window: every saved window's tabs together, pinned first, groups kept", async ({ worker, context, extensionId }) => {
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const first = await openWindow(worker, { pages: ["one-pin", "one-a"], pinned: ["one-pin"], group: { title: "First", pages: ["one-a"] } });
  const second = await openWindow(worker, { pages: ["two-pin", "two-a", "two-b"], pinned: ["two-pin"], group: { title: "Second", pages: ["two-b"] } });
  const sessionId = await saveTabs(worker, manager, [first, second]);
  const windowsBefore = await windowIds(worker);

  const response = await send(manager, { type: "restore.start", sessionId, target: { kind: "one-window" } });
  expect(response).toMatchObject({ ok: true, data: { job: { status: "completed", target: "one-window", plan: { tabCount: 5 } } } });

  const added = (await windowIds(worker)).filter((id) => !windowsBefore.includes(id));
  expect(added).toHaveLength(1);
  await expect.poll(() => readWindow(worker, added[0]!)).toEqual([
    { page: "one-pin", pinned: true, group: null },
    { page: "two-pin", pinned: true, group: null },
    { page: "one-a", pinned: false, group: "First" },
    { page: "two-a", pinned: false, group: null },
    { page: "two-b", pinned: false, group: "Second" },
  ]);
});

test("a closed target window opens nothing and leaves no job", async ({ worker, context, extensionId }) => {
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const saved = await openWindow(worker, { pages: ["kept"] });
  const sessionId = await saveTabs(worker, manager, [saved]);
  const gone = await openWindow(worker, { pages: ["closing"] });
  await worker.evaluate((id) => chrome.windows.remove(id), gone.windowId);
  const windowsBefore = await windowIds(worker);

  const response = await send(manager, { type: "restore.start", sessionId, target: { kind: "this-window", windowId: gone.windowId, skipOpen: true } });
  expect(response).toMatchObject({ ok: false, error: { code: "browser-error", message: "That window is no longer open, so nothing was opened" } });
  expect(await countRestoreJobs(manager)).toBe(0);
  expect(await windowIds(worker)).toEqual(windowsBefore);
  expect(await readWindow(worker, saved.windowId)).toEqual([{ page: "kept", pinned: false, group: null }]);
});

test("the open picker: untick a tab, choose This window, and only the ticked tabs join the manager's window", async ({ worker, context, extensionId }) => {
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const saved = await openWindow(worker, { pages: ["keep-one", "leave-out", "keep-two"] });
  const sessionId = await saveTabs(worker, manager, [saved]);
  const managerWindow = await worker.evaluate(async (id) => (await chrome.tabs.query({ url: `chrome-extension://${id}/manager.html*` }))[0]!.windowId, extensionId);

  await manager.goto(`chrome-extension://${extensionId}/manager.html#session=${sessionId}`);
  const inspector = manager.getByRole("article", { name: /session details/i });
  await expect(inspector.getByRole("button", { name: "Open 3 tabs in 1 new window" })).toBeVisible();
  const before = await readWindow(worker, managerWindow);
  await inspector.getByRole("checkbox", { name: /leave-out/ }).uncheck();
  await inspector.getByRole("button", { name: "Choose where to open" }).click();
  await manager.getByRole("menuitemradio", { name: "This window" }).click();
  await inspector.getByRole("button", { name: "Open 2 tabs in this window" }).click();
  await expect(inspector.getByText("Opened 2 of 2 tabs in this window.")).toBeVisible();

  await expect.poll(() => readWindow(worker, managerWindow)).toEqual([
    ...before,
    { page: "keep-one", pinned: false, group: null },
    { page: "keep-two", pinned: false, group: null },
  ]);
  // The choice is remembered for the next open, here and in the popup.
  await manager.reload();
  await expect(inspector.getByRole("button", { name: "Open 3 tabs in this window" })).toBeVisible();
});
