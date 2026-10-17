import { savedWindowSchema } from "@sessionhub/contracts/session";
import { describe, expect, it } from "vitest";
import { buildCanonicalStructure } from "./session-structure";
import { sequentialIds } from "./test-helpers";

const g1 = "4b0c1c52-7a4d-4a0e-9a59-6d5f1f1e2b3c";

describe("buildCanonicalStructure", () => {
  const input = [
    {
      groups: [{ id: g1, title: "Docs", color: "blue" as const, collapsed: true }],
      tabs: [
        { title: "A", url: "https://a.test/", pinned: true, groupId: null },
        { title: "B", url: "https://b.test/", pinned: false, groupId: g1 },
        { title: "Bad", url: "javascript:alert(1)", pinned: false, groupId: null },
      ],
    },
    { groups: [], tabs: [{ title: "C", url: "chrome://settings", pinned: false, groupId: null }] },
  ];

  it("assigns fresh ids, remaps group references and orders by position", () => {
    const { windows, windowCount, tabCount } = buildCanonicalStructure(input, sequentialIds());
    expect({ windowCount, tabCount }).toEqual({ windowCount: 2, tabCount: 4 });
    const [first] = windows;
    expect(first!.groups[0]!.id).not.toBe(g1);
    expect(first!.tabs[1]!.groupId).toBe(first!.groups[0]!.id);
    expect(first!.tabs.map((tab) => tab.sortOrder)).toEqual([0, 1, 2]);
    expect(windows.map((window) => window.sortOrder)).toEqual([0, 1]);
    for (const window of windows) expect(savedWindowSchema.safeParse(window).success).toBe(true);
  });

  it("re-classifies every url", () => {
    const { windows } = buildCanonicalStructure(input, sequentialIds());
    expect(windows.flatMap((window) => window.tabs.map((tab) => tab.eligibility))).toEqual([
      "restorable",
      "restorable",
      "unsafe",
      "browser-internal",
    ]);
  });

  it("never reuses an id", () => {
    const { windows } = buildCanonicalStructure(input, sequentialIds());
    const ids = windows.flatMap((window) => [window.id, ...window.groups.map((g) => g.id), ...window.tabs.map((t) => t.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
