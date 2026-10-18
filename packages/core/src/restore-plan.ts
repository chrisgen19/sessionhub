import type { RestoreEligibility, SavedSession, TabGroupColor, WindowBounds, WindowState } from "@sessionhub/contracts/session";
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
  /** The saved window's state: maximized and full screen reopen as such on any computer. */
  state?: WindowState;
  /** Its saved position and size, planned only when the session was saved on this computer. */
  bounds?: WindowBounds;
}

export interface SkippedTab {
  sourceTabId: string;
  title: string;
  url: string;
  eligibility: Exclude<RestoreEligibility, "restorable">;
  reason: string;
}

/** A selected tab left out because its exact URL was already open where the tabs were going. */
export interface AlreadyOpenTab {
  sourceTabId: string;
  url: string;
}

export interface RestorePlan {
  sessionId: string;
  windows: PlannedWindow[];
  /** Selected tabs that will not be opened, with user-readable reasons. */
  skipped: SkippedTab[];
  /** Selected tabs already open in the target window (only when the user asked to skip those). */
  alreadyOpen?: AlreadyOpenTab[];
  tabCount: number;
}

/**
 * Where restored tabs go: one new window per saved window (`new-windows`, the default), every tab in
 * one new window (`one-window`), or appended to a window that is already open (`this-window`).
 */
export type RestoreDestination = "new-windows" | "one-window" | "this-window";

export interface RestoreSelection {
  /** Tabs to restore; omit to restore every tab in the session. */
  tabIds?: ReadonlySet<string>;
  /** `single` merges every planned window into one (for one new window or the current window). */
  layout?: "original" | "single";
  /**
   * Reopen windows at their saved position and size: only for a session saved on this computer,
   * since other computers' screens differ (docs/DATA_MODEL.md). States apply either way.
   */
  bounds?: boolean;
}

const countTabs = (windows: PlannedWindow[]) => windows.reduce((sum, window) => sum + window.tabs.length, 0);

/** The window with only `tabs`, keeping just the groups those tabs still use. */
const withTabs = (window: PlannedWindow, tabs: PlannedTab[]): PlannedWindow => {
  const usedGroups = new Set(tabs.map((tab) => tab.groupId));
  return { ...window, tabs, groups: window.groups.filter((group) => usedGroups.has(group.sourceGroupId)) };
};

/**
 * One window holding every planned tab: window order, pinned tabs first overall, every group kept.
 * No saved state or bounds: the merged window isn't any one saved window.
 */
const mergeWindows = (windows: PlannedWindow[]): PlannedWindow[] => {
  const [first] = windows;
  if (!first) return windows;
  if (windows.length === 1) return [{ sourceWindowId: first.sourceWindowId, tabs: first.tabs, groups: first.groups }];
  const tabs = windows.flatMap((window) => window.tabs);
  return [
    {
      sourceWindowId: first.sourceWindowId,
      tabs: [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)],
      // Group ids are unique across a session's windows (savedSessionSchema), so none collide.
      groups: windows.flatMap((window) => window.groups),
    },
  ];
};

/**
 * Deterministic restore plan: one window per saved window that still has restorable
 * selected tabs, or all of them in one window with `layout: "single"`. URLs are
 * re-classified at plan time. Never references or closes existing browser state.
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
    windows.push({
      sourceWindowId: window.id,
      tabs: pinnedFirst,
      groups,
      ...(window.state && { state: window.state }),
      ...(selection.bounds && window.state === "normal" && window.bounds && { bounds: window.bounds }),
    });
  }

  const planned = selection.layout === "single" ? mergeWindows(windows) : windows;
  return { sessionId: session.id, windows: planned, skipped, tabCount: countTabs(planned) };
};

/**
 * The plan minus tabs whose exact URL is already open where the tabs are going. They are
 * listed in `alreadyOpen` instead, so the summary can name them and a retry never opens them.
 * Groups and windows left without tabs are dropped.
 */
export const withoutOpenTabs = (plan: RestorePlan, openUrls: ReadonlySet<string>): RestorePlan => {
  const alreadyOpen: AlreadyOpenTab[] = [];
  const windows = plan.windows
    .map((window) =>
      withTabs(
        window,
        window.tabs.filter((tab) => {
          if (!openUrls.has(tab.url)) return true;
          alreadyOpen.push({ sourceTabId: tab.sourceTabId, url: tab.url });
          return false;
        }),
      ),
    )
    .filter((window) => window.tabs.length > 0);
  return { ...plan, windows, alreadyOpen, tabCount: countTabs(windows) };
};

/**
 * Plan for retrying a restore: the original plan minus every tab that already opened
 * in an earlier attempt. Tabs that failed or were never attempted (interrupted run)
 * remain. URLs are re-checked, groups are kept only where tabs remain, and skipped
 * tabs are not retried (they were never restorable).
 */
export const planRetry = (plan: RestorePlan, openedTabIds: ReadonlySet<string>): RestorePlan => {
  const windows = plan.windows
    .map((window) =>
      withTabs(
        window,
        window.tabs.filter((tab) => !openedTabIds.has(tab.sourceTabId) && classifyUrl(tab.url).eligibility === "restorable"),
      ),
    )
    .filter((window) => window.tabs.length > 0);
  // `alreadyOpen` tabs were never in `windows`, so they are never retried.
  return { sessionId: plan.sessionId, windows, skipped: [], tabCount: countTabs(windows) };
};
