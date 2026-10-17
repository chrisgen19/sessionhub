import { describe, expect, it } from "vitest";
import {
  initialSelection,
  reconcile,
  selectAll,
  selectTabs,
  summarize,
  toggleRange,
  toggleTab,
  toggleWindow,
  windowState,
  type OpenTab,
  type OpenWindow,
} from "./tab-selection";

const tab = (id: number, eligibility: OpenTab["eligibility"] = "restorable"): OpenTab => ({
  id,
  title: `Tab ${id}`,
  url: eligibility === "restorable" ? `https://site.test/${id}` : "chrome://settings",
  pinned: false,
  groupId: null,
  eligibility,
});

// Window 1: three web pages and a browser page. Window 2: two web pages. Window 3: browser pages only.
const windows: OpenWindow[] = [
  { id: 1, tabs: [tab(11), tab(12), tab(13), tab(14, "browser-internal")], groups: [] },
  { id: 2, tabs: [tab(21), tab(22)], groups: [] },
  { id: 3, tabs: [tab(31, "browser-internal"), tab(32, "browser-internal")], groups: [] },
];
const [first, second, onlyBrowserPages] = windows as [OpenWindow, OpenWindow, OpenWindow];
const ids = (selection: ReadonlySet<number>) => [...selection].sort((a, b) => a - b);

describe("save picker selection", () => {
  it("opens with the current window's web pages ticked: other windows and browser pages are unticked", () => {
    const selection = initialSelection(windows, 1);
    expect(ids(selection)).toEqual([11, 12, 13]);
    expect([windowState(first, selection), windowState(second, selection)]).toEqual(["checked", "unchecked"]);
    expect(ids(initialSelection(windows, 99))).toEqual([]);
  });

  it("a window header ticks its web pages, and unticks everything in it once checked", () => {
    const ticked = toggleWindow(new Set(), second);
    expect(ids(ticked)).toEqual([21, 22]);
    expect(windowState(second, ticked)).toBe("checked");
    expect(ids(toggleWindow(ticked, second))).toEqual([]);

    // A browser page ticked by hand doesn't keep the header from being checked, and goes when it unticks.
    const withPage = toggleTab(initialSelection(windows, 1), 14);
    expect(windowState(first, withPage)).toBe("checked");
    expect(ids(toggleWindow(withPage, first))).toEqual([]);
  });

  it("shows a partly ticked window as mixed, and the header then ticks the rest", () => {
    const partial = toggleTab(initialSelection(windows, 1), 12);
    expect(windowState(first, partial)).toBe("mixed");
    expect(ids(toggleWindow(partial, first))).toEqual([11, 12, 13]);
  });

  it("ticks browser pages only by hand, except in a window that has nothing else", () => {
    expect(ids(selectAll(windows))).toEqual([11, 12, 13, 21, 22, 31, 32]);
    expect(ids(toggleWindow(new Set(), onlyBrowserPages))).toEqual([31, 32]);
  });

  it("Shift-click sets a range in visible order to the clicked tab's new state", () => {
    const order = [11, 12, 13, 14, 21, 22];
    expect(ids(toggleRange(new Set(), order, 12, 21))).toEqual([12, 13, 14, 21]);
    expect(ids(toggleRange(new Set([11, 12, 13, 21]), order, 21, 12))).toEqual([11]);
    expect(ids(toggleRange(new Set(), order, null, 13))).toEqual([13]);
  });

  it("drops closed tabs and never ticks tabs opened after the picker loaded", () => {
    const selection = new Set([11, 12, 21]);
    const later: OpenWindow[] = [{ id: 1, tabs: [tab(11), tab(15)], groups: [] }, second];
    expect(ids(reconcile(selection, later))).toEqual([11, 21]);
    expect(reconcile(new Set([11]), later)).toBeInstanceOf(Set);
  });

  it("summarizes what will be saved", () => {
    expect(summarize(new Set([11, 14, 21]), windows)).toEqual({ tabs: 3, windows: 2, browserPages: 1 });
    expect(summarize(new Set(), windows)).toEqual({ tabs: 0, windows: 0, browserPages: 0 });
  });

  it("keeps only the ticked tabs of Chrome's windows for the worker, dropping windows left empty", () => {
    const chrome = [
      { id: 1, tabs: [{ id: 11 }, { id: 12 }, { id: undefined }] },
      { id: 2, tabs: [{ id: 21 }] },
      { id: 3 },
    ];
    expect(selectTabs(chrome, [12, 99])).toEqual([{ id: 1, tabs: [{ id: 12 }] }]);
  });
});
