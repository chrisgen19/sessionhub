import { describe, expect, it } from "vitest";
import { duplicateTabIds, matchingOpenTabIds } from "./open-tabs";
import type { OpenTab, OpenWindow } from "./tab-selection";
import { sampleOpenWindows } from "./test-fixtures";

const tab = (id: number, url: string, title = ""): OpenTab => ({ id, title, url, pinned: false, groupId: null, eligibility: "restorable" });

describe("open tabs view rules", () => {
  it("marks every later copy of an address as a duplicate, across windows, keeping the first", () => {
    const windows: OpenWindow[] = [
      { id: 1, tabs: [tab(1, "https://a.test/"), tab(2, "https://b.test/"), tab(3, "https://a.test/")], groups: [] },
      { id: 2, tabs: [tab(4, "https://b.test/"), tab(5, "https://a.test/"), tab(6, "https://a.test/#top")], groups: [] },
    ];
    expect(duplicateTabIds(windows)).toEqual(new Set([3, 4, 5]));
  });

  it("never counts a tab without an address yet", () => {
    expect(duplicateTabIds([{ id: 1, tabs: [tab(1, ""), tab(2, "")], groups: [] }])).toEqual(new Set());
    expect(duplicateTabIds(sampleOpenWindows())).toEqual(new Set());
  });

  it("matches every search term in the title or address, and filters nothing without a search", () => {
    const windows = sampleOpenWindows();
    expect(matchingOpenTabIds(windows, "react")).toEqual(new Set([102]));
    expect(matchingOpenTabIds(windows, "github login")).toEqual(new Set([101]));
    expect(matchingOpenTabIds(windows, "example.com")).toEqual(new Set([201]));
    expect(matchingOpenTabIds(windows, "nothing here")).toEqual(new Set());
    expect(matchingOpenTabIds(windows, "   ")).toBeNull();
  });
});
