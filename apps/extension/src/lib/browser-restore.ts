import { browser } from "wxt/browser";
import type { PlannedWindow } from "@sessionhub/core/restore-plan";
import type { RestoreTabOutcome } from "./db";
import type { HandlerDeps } from "./command-handlers";

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

/**
 * Opens one planned window as a NEW browser window. Existing windows and tabs are
 * never closed, moved or navigated. Each tab is attempted independently, and its
 * outcome is recorded before the next tab opens, so a worker stopped mid-window
 * leaves at most the tab it was opening unrecorded. A recording error stops the window.
 */
export const restoreBrowserWindow: HandlerDeps["restoreWindow"] = async (window, record) => {
  const [first, ...rest] = window.tabs;
  if (!first) return [];

  let windowId: number;
  let firstTabId: number;
  const createdIds = new Map<string, number>();
  try {
    const created = await browser.windows.create({ url: first.url, focused: true });
    const returnedTabId = created?.tabs?.[0]?.id;
    if (created?.id === undefined || returnedTabId === undefined) throw new Error("Browser didn't return the new window");
    windowId = created.id;
    firstTabId = returnedTabId;
    createdIds.set(first.sourceTabId, firstTabId);
  } catch (error) {
    return window.tabs.map((tab) => ({ sourceTabId: tab.sourceTabId, status: "failed", error: message(error) }));
  }

  const outcomes: RestoreTabOutcome[] = [];
  const settle = async (outcome: RestoreTabOutcome) => {
    outcomes.push(outcome);
    await record(outcome);
  };
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
  for (const tab of rest) {
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
  await applyGroups(window, windowId, createdIds);
  return outcomes;
};
