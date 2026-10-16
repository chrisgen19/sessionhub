import type { RestoreEligibility, SavedSession, TabGroupColor } from "@sessionhub/contracts/session";
import { classifyUrl } from "./url-classification";

export interface PlannedTab {
  sourceTabId: string;
  url: string;
  pinned: boolean;
  /** Source group id; always null for pinned tabs (Chrome can't group pinned tabs). */
  groupId: string | null;
}

export interface PlannedGroup {
  sourceGroupId: string;
  title: string;
  color: TabGroupColor;
  collapsed: boolean;
}

export interface PlannedWindow {
  sourceWindowId: string;
  /** Pinned tabs first (Chrome requirement), then saved order. */
  tabs: PlannedTab[];
  /** Only groups that keep at least one planned tab, in saved order. */
  groups: PlannedGroup[];
}

export interface SkippedTab {
  sourceTabId: string;
  title: string;
  url: string;
  eligibility: Exclude<RestoreEligibility, "restorable">;
  reason: string;
}

export interface RestorePlan {
  sessionId: string;
  windows: PlannedWindow[];
  /** Selected tabs that will not be opened, with user-readable reasons. */
  skipped: SkippedTab[];
  tabCount: number;
}

export interface RestoreSelection {
  /** Tabs to restore; omit to restore every tab in the session. */
  tabIds?: ReadonlySet<string>;
}

/**
 * Deterministic restore plan: one new window per saved window that still has
 * restorable selected tabs. URLs are re-classified at plan time. Never references
 * or closes existing browser state.
 */
export const planRestore = (session: SavedSession, selection: RestoreSelection = {}): RestorePlan => {
  const isSelected = (tabId: string) => selection.tabIds?.has(tabId) ?? true;
  const skipped: SkippedTab[] = [];
  const windows: PlannedWindow[] = [];

  for (const window of [...session.windows].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const ordered = window.tabs.filter((tab) => isSelected(tab.id)).sort((a, b) => a.sortOrder - b.sortOrder);
    const tabs: PlannedTab[] = [];
    for (const tab of ordered) {
      // Re-classify instead of trusting the stored field, so tampered or imported data
      // can never smuggle an unsafe URL into a restore.
      const { eligibility, reason } = classifyUrl(tab.url);
      if (eligibility !== "restorable") {
        skipped.push({ sourceTabId: tab.id, title: tab.title, url: tab.url, eligibility, reason: reason ?? "" });
        continue;
      }
      tabs.push({ sourceTabId: tab.id, url: tab.url, pinned: tab.pinned, groupId: tab.pinned ? null : tab.groupId });
    }
    if (tabs.length === 0) continue;

    const pinnedFirst = [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)];
    const usedGroups = new Set(pinnedFirst.map((tab) => tab.groupId));
    const groups = [...window.groups]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((group) => usedGroups.has(group.id))
      .map((group) => ({
        sourceGroupId: group.id,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
      }));
    windows.push({ sourceWindowId: window.id, tabs: pinnedFirst, groups });
  }

  return {
    sessionId: session.id,
    windows,
    skipped,
    tabCount: windows.reduce((sum, window) => sum + window.tabs.length, 0),
  };
};
