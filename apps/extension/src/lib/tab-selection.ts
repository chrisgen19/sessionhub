import type { RestoreEligibility } from "@sessionhub/contracts/session";

/**
 * Which open tabs the user ticked in the save picker (docs/UI_UX_DESIGN.md 18i). Pure, so the
 * rules are testable: nothing is saved that the user didn't tick, browser pages are opt-in, and
 * tabs that open after the picker loaded arrive unticked. Tab ids are Chrome's runtime ids: valid
 * for this save only, never stored.
 */

export interface OpenTab {
  id: number;
  title: string;
  url: string;
  pinned: boolean;
  /** Chrome's tab group id, or null. */
  groupId: number | null;
  eligibility: RestoreEligibility;
}

export interface OpenGroup {
  id: number;
  title: string;
  color: string;
}

export interface OpenWindow {
  id: number;
  /** In tab-strip order. */
  tabs: OpenTab[];
  groups: OpenGroup[];
}

export type TabSelection = ReadonlySet<number>;
export type WindowState = "checked" | "mixed" | "unchecked";

const restorable = (tab: OpenTab) => tab.eligibility === "restorable";

/** What a window header ticks: its restorable tabs, or every tab when it has only browser pages. */
export const headerTargets = (window: OpenWindow): OpenTab[] => {
  const tabs = window.tabs.filter(restorable);
  return tabs.length > 0 ? tabs : window.tabs;
};

/** When the picker opens: the restorable tabs of the window the user is in. */
export const initialSelection = (windows: OpenWindow[], currentWindowId: number | null): TabSelection => {
  const current = windows.find((window) => window.id === currentWindowId);
  return new Set(current ? current.tabs.filter(restorable).map((tab) => tab.id) : []);
};

/** Checked once every header target is ticked (browser pages are opt-in, so they don't count against it). */
export const windowState = (window: OpenWindow, selection: TabSelection): WindowState => {
  const targets = headerTargets(window);
  if (targets.length > 0 && targets.every((tab) => selection.has(tab.id))) return "checked";
  return window.tabs.some((tab) => selection.has(tab.id)) ? "mixed" : "unchecked";
};

/** A header click: unticks the whole window when it is checked, otherwise ticks its header targets. */
export const toggleWindow = (selection: TabSelection, window: OpenWindow): TabSelection => {
  const next = new Set(selection);
  if (windowState(window, selection) === "checked") for (const tab of window.tabs) next.delete(tab.id);
  else for (const tab of headerTargets(window)) next.add(tab.id);
  return next;
};

/** Generic over the id: Chrome's numeric tab ids here, saved tab ids (strings) in the open picker. */
export const toggleTab = <Id>(selection: ReadonlySet<Id>, tabId: NoInfer<Id>): ReadonlySet<Id> => {
  const next = new Set(selection);
  if (next.has(tabId)) next.delete(tabId);
  else next.add(tabId);
  return next;
};

/**
 * Shift-click: every tab from the anchor to the clicked tab, in visible order, takes the state the
 * clicked tab is switching to. Without a usable anchor it is a plain toggle. Pass only tabs that can
 * be ticked as `visibleOrder`.
 */
export const toggleRange = <Id>(
  selection: NoInfer<ReadonlySet<Id>>,
  visibleOrder: Id[],
  anchorId: NoInfer<Id> | null,
  tabId: NoInfer<Id>,
): ReadonlySet<Id> => {
  const from = anchorId === null ? -1 : visibleOrder.indexOf(anchorId);
  const to = visibleOrder.indexOf(tabId);
  if (from < 0 || to < 0) return toggleTab(selection, tabId);
  const select = !selection.has(tabId);
  const next = new Set(selection);
  for (const id of visibleOrder.slice(Math.min(from, to), Math.max(from, to) + 1)) {
    if (select) next.add(id);
    else next.delete(id);
  }
  return next;
};

export const selectAll = (windows: OpenWindow[]): TabSelection => new Set(windows.flatMap((window) => headerTargets(window).map((tab) => tab.id)));

const eligibilityById = (windows: OpenWindow[]) => new Map(windows.flatMap((window) => window.tabs.map((tab) => [tab.id, tab.eligibility] as const)));

/**
 * After the open tabs changed: closed tabs drop out of the selection (new ones were never in it),
 * and so does a ticked web page that has since become a browser page (it navigated to
 * `chrome://...`, say): browser pages stay opt-in. One the user ticked as a browser page stays.
 * `previous` is the view the selection was made against.
 */
export const reconcile = (selection: TabSelection, windows: OpenWindow[], previous: OpenWindow[] = []): TabSelection => {
  const now = eligibilityById(windows);
  const before = eligibilityById(previous);
  const kept = [...selection].filter((id) => {
    const eligibility = now.get(id);
    if (eligibility === undefined) return false;
    return !(before.get(id) === "restorable" && eligibility !== "restorable");
  });
  return kept.length === selection.size ? selection : new Set(kept);
};

export interface SelectionSummary {
  tabs: number;
  windows: number;
  /** Ticked tabs that can't reopen: saved for reference only. */
  browserPages: number;
}

export const summarize = (selection: TabSelection, windows: OpenWindow[]): SelectionSummary => {
  const ticked = windows.map((window) => window.tabs.filter((tab) => selection.has(tab.id)));
  return {
    tabs: ticked.reduce((sum, tabs) => sum + tabs.length, 0),
    windows: ticked.filter((tabs) => tabs.length > 0).length,
    browserPages: ticked.flat().filter((tab) => !restorable(tab)).length,
  };
};

/**
 * The worker's half: keeps only the ticked tabs of Chrome's windows and drops windows left
 * without any. Titles and URLs come from Chrome here, never from the page that ticked them.
 */
export const selectTabs = <W extends { tabs?: T[] }, T extends { id?: number }>(windows: W[], tabIds: Iterable<number>): W[] => {
  const ids = new Set(tabIds);
  return windows
    .map((window) => ({ ...window, tabs: (window.tabs ?? []).filter((tab) => tab.id !== undefined && ids.has(tab.id)) }))
    .filter((window) => window.tabs.length > 0);
};
