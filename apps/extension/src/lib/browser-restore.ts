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
 * never closed, moved or navigated. Each tab is attempted independently.
 */
export const restoreBrowserWindow: HandlerDeps["restoreWindow"] = async (window) => {
  const [first, ...rest] = window.tabs;
  if (!first) return [];

  let windowId: number;
  const createdIds = new Map<string, number>();
  try {
    const created = await browser.windows.create({ url: first.url, focused: true });
    const firstTabId = created?.tabs?.[0]?.id;
    if (created?.id === undefined || firstTabId === undefined) throw new Error("Browser didn't return the new window");
    windowId = created.id;
    createdIds.set(first.sourceTabId, firstTabId);
    if (first.pinned) await browser.tabs.update(firstTabId, { pinned: true });
  } catch (error) {
    return window.tabs.map((tab) => ({ sourceTabId: tab.sourceTabId, status: "failed", error: message(error) }));
  }

  const outcomes: RestoreTabOutcome[] = [{ sourceTabId: first.sourceTabId, status: "opened" }];
  for (const tab of rest) {
    try {
      const created = await browser.tabs.create({ windowId, url: tab.url, pinned: tab.pinned, active: false });
      if (created.id !== undefined) createdIds.set(tab.sourceTabId, created.id);
      outcomes.push({ sourceTabId: tab.sourceTabId, status: "opened" });
    } catch (error) {
      outcomes.push({ sourceTabId: tab.sourceTabId, status: "failed", error: message(error) });
    }
  }
  await applyGroups(window, windowId, createdIds);
  return outcomes;
};
