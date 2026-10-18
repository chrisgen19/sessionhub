import { browser, type Browser } from "wxt/browser";
import type { PlannedTab, PlannedWindow } from "@sessionhub/core/restore-plan";
import type { RestoreTabOutcome } from "./db";
import { BrowserError, type HandlerDeps } from "./command-handlers";
import { createPlacement, isOffScreenError } from "./window-placement";

/**
 * A new focused window at the planned state or position and size. Chrome refuses bounds that are
 * less than half on a screen (a monitor unplugged since, say); then it opens where Chrome puts new
 * windows, rather than not at all (docs/SYSTEM_DESIGN.md decisions log, 2026-10-18 spike).
 */
const createWindow = async (url: string, window: PlannedWindow) => {
  const placement = createPlacement(window);
  let created: Browser.windows.Window | undefined;
  try {
    created = await browser.windows.create({ url, focused: true, ...placement });
  } catch (error) {
    if (placement.left === undefined || !isOffScreenError(error)) throw error;
    return browser.windows.create({ url, focused: true });
  }
  // macOS opens a window created full screen as a normal one; switching it once open works.
  // Best effort: the window and its first tab exist either way.
  if (placement.state === "fullscreen" && created?.id !== undefined && created.state !== "fullscreen") {
    await browser.windows.update(created.id, { state: "fullscreen" }).catch(() => undefined);
  }
  return created;
};

/** User-readable failure reason; Chrome's raw messages include runtime ids. */
const message = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : "";
  if (/no window with id/i.test(raw)) return "The window was closed before this tab could open";
  if (/no tab with id/i.test(raw)) return "The tab was closed while it was being restored";
  return raw || "Couldn't open this tab";
};

const applyGroups = async (window: PlannedWindow, windowId: number, createdIds: Map<string, number>) => {
  for (const group of window.groups) {
    const tabIds = window.tabs
      .filter((tab) => tab.groupId === group.sourceGroupId)
      .map((tab) => createdIds.get(tab.sourceTabId))
      .filter((id) => id !== undefined);
    const [first, ...rest] = tabIds;
    if (first === undefined) continue;
    try {
      const groupId = await browser.tabs.group({ tabIds: [first, ...rest], createProperties: { windowId } });
      await browser.tabGroups.update(groupId, { title: group.title, color: group.color, collapsed: group.collapsed });
    } catch {
      // Grouping is cosmetic: the tabs are already open, so keep going.
    }
  }
};

/** How long a lazy open waits for pages to start loading before unloading them; slower tabs stay loaded. */
export const UNLOAD_WAIT_MS = 8_000;

/**
 * The tabs whose navigation has committed (`url` set) within `ms`. Discarding a tab before that
 * leaves it blank, with no URL (lazy loading spike, docs/SYSTEM_DESIGN.md decisions log).
 */
const committedTabs = (tabIds: number[], ms: number) =>
  new Promise<number[]>((resolve) => {
    const pending = new Set(tabIds);
    const committed: number[] = [];
    const settle = (tabId: number, url: string | undefined) => {
      if (!pending.has(tabId) || !url) return;
      pending.delete(tabId);
      committed.push(tabId);
      if (pending.size === 0) finish();
    };
    const listener = (tabId: number, _change: unknown, tab: { url?: string }) => settle(tabId, tab.url);
    const finish = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      resolve(committed);
    };
    const timer = setTimeout(finish, ms);
    browser.tabs.onUpdated.addListener(listener);
    if (pending.size === 0) finish();
    for (const tabId of tabIds) {
      browser.tabs.get(tabId).then(
        (tab) => settle(tabId, tab.url),
        () => {
          // Closed meanwhile: nothing to unload.
          pending.delete(tabId);
          if (pending.size === 0) finish();
        },
      );
    }
  });

/**
 * Lazy open, best effort: once each background tab's page has started loading, unload it so it
 * stops using memory; Chrome loads it again when it's selected. Chrome can't create a tab unloaded,
 * so each page does start loading. The active tab is never unloaded, and a tab that can't be
 * unloaded (or commits too late) just stays loaded; the restore outcome is already recorded.
 * Must run after grouping: Chrome gives a discarded tab a new id.
 */
const unloadInBackground = async (tabIds: number[]) => {
  for (const tabId of await committedTabs(tabIds, UNLOAD_WAIT_MS)) {
    try {
      const tab = await browser.tabs.get(tabId);
      if (!tab.active) await browser.tabs.discard(tabId);
    } catch {
      // Closed, or Chrome refused: it stays as it is.
    }
  }
};

/** Collects outcomes and records each one as it settles. */
const outcomeLog = (record: (outcome: RestoreTabOutcome) => Promise<void>) => {
  const outcomes: RestoreTabOutcome[] = [];
  const settle = async (outcome: RestoreTabOutcome) => {
    outcomes.push(outcome);
    await record(outcome);
  };
  return { outcomes, settle };
};

/** Opens each tab in background in `windowId`, recording its outcome before the next tab opens. */
const openTabs = async (
  tabs: PlannedTab[],
  windowId: number,
  createdIds: Map<string, number>,
  settle: (outcome: RestoreTabOutcome) => Promise<void>,
) => {
  for (const tab of tabs) {
    let outcome: RestoreTabOutcome;
    try {
      const created = await browser.tabs.create({ windowId, url: tab.url, pinned: tab.pinned, active: false });
      if (created.id !== undefined) createdIds.set(tab.sourceTabId, created.id);
      outcome = { sourceTabId: tab.sourceTabId, status: "opened" };
    } catch (error) {
      outcome = { sourceTabId: tab.sourceTabId, status: "failed", error: message(error) };
    }
    await settle(outcome);
  }
};

/**
 * Opens one planned window as a NEW browser window, or with `into` appends its tabs (in background,
 * after the existing ones) to that open window. Existing windows and tabs are never closed, moved
 * or navigated. Each tab is attempted independently, and its outcome is recorded before the next
 * tab opens, so a worker stopped mid-window leaves at most the tab it was opening unrecorded. A
 * recording error stops the window. With `lazy`, background tabs are unloaded once they start loading.
 */
export const restoreBrowserWindow: HandlerDeps["restoreWindow"] = async (window, record, { into, lazy } = {}) => {
  const createdIds = new Map<string, number>();
  const { outcomes, settle } = outcomeLog(record);
  if (into !== undefined) {
    await openTabs(window.tabs, into, createdIds, settle);
    await applyGroups(window, into, createdIds);
    if (lazy) await unloadInBackground([...createdIds.values()]);
    return outcomes;
  }

  const [first, ...rest] = window.tabs;
  if (!first) return [];

  let windowId: number;
  let firstTabId: number;
  try {
    const created = await createWindow(first.url, window);
    const returnedTabId = created?.tabs?.[0]?.id;
    if (created?.id === undefined || returnedTabId === undefined) throw new Error("Browser didn't return the new window");
    windowId = created.id;
    firstTabId = returnedTabId;
    createdIds.set(first.sourceTabId, firstTabId);
  } catch (error) {
    return window.tabs.map((tab) => ({ sourceTabId: tab.sourceTabId, status: "failed", error: message(error) }));
  }

  // Persist the successful open before cosmetic work: pinning can fail after the tab
  // exists. Reporting that as a failed open would duplicate it on Retry.
  await settle({ sourceTabId: first.sourceTabId, status: "opened" });
  if (first.pinned) {
    try {
      await browser.tabs.update(firstTabId, { pinned: true });
    } catch {
      // Like group metadata, pinning is best effort; the URL is already open.
    }
  }
  await openTabs(rest, windowId, createdIds, settle);
  await applyGroups(window, windowId, createdIds);
  if (lazy) await unloadInBackground([...createdIds.values()]);
  return outcomes;
};

/** The URLs open in a window tabs are about to be restored into, after checking it can take them. */
export const inspectBrowserWindow: NonNullable<HandlerDeps["inspectWindow"]> = async (windowId) => {
  const window = await browser.windows.get(windowId, { populate: true }).catch(() => {
    throw new BrowserError("That window is no longer open, so nothing was opened");
  });
  if (window.incognito) throw new BrowserError("SessionHub doesn't open tabs in private windows");
  if (window.type !== "normal") throw new BrowserError("Tabs can only be opened in a normal browser window");
  return { openUrls: (window.tabs ?? []).map((tab) => tab.url || tab.pendingUrl || "").filter((url) => url !== "") };
};
