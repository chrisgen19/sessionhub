import { describe, expect, it } from "vitest";
import type { CaptureWindowInput } from "./capture";
import { diffSnapshotUrls, fingerprintCapture, selectSnapshotsToEvict, type SnapshotMeta } from "./recovery";
import { tab } from "./test-helpers";

const base = (): CaptureWindowInput[] => [
  {
    tabs: [tab(0, "https://a.test", { pinned: true }), tab(1, "https://b.test", { groupKey: 7, title: "(1) Inbox" })],
    groups: [{ key: 7, title: "Mail", color: "blue", collapsed: false }],
  },
  { tabs: [tab(0, "https://c.test")], groups: [] },
];

describe("fingerprintCapture", () => {
  it("is stable and ignores titles, collapsed state, runtime group ids and tab index gaps", () => {
    const changed = base();
    changed[0]!.tabs[1]!.title = "(7) Inbox";
    changed[0]!.groups[0]!.collapsed = true;
    changed[0]!.groups[0]!.key = 99;
    changed[0]!.tabs[1]!.groupKey = 99;
    changed[0]!.tabs[1]!.index = 5;
    expect(fingerprintCapture(changed)).toBe(fingerprintCapture(base()));
  });

  it.each<[string, (windows: CaptureWindowInput[]) => void]>([
    ["a url change", (w) => (w[0]!.tabs[0]!.url = "https://z.test")],
    ["a pin change", (w) => (w[0]!.tabs[0]!.pinned = false)],
    ["a group rename", (w) => (w[0]!.groups[0]!.title = "Work")],
    ["ungrouping", (w) => (w[0]!.tabs[1]!.groupKey = null)],
    ["moving a tab to another window", (w) => w[1]!.tabs.push(w[0]!.tabs.pop()!)],
    ["reordering tabs", (w) => ((w[0]!.tabs[0]!.index = 3), (w[0]!.tabs[0]!.pinned = true))],
    ["a closed window", (w) => w.pop()],
  ])("changes on %s", (_label, mutate) => {
    const changed = base();
    mutate(changed);
    expect(fingerprintCapture(changed)).not.toBe(fingerprintCapture(base()));
  });
});

describe("selectSnapshotsToEvict", () => {
  const now = new Date("2026-10-16T12:00:00.000Z");
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  const snap = (id: string, hoursAgo: number, tabCount = 10): SnapshotMeta => ({ id, capturedAt: at(hoursAgo), tabCount });

  it("keeps the newest maxCount and evicts the rest", () => {
    const snapshots = Array.from({ length: 6 }, (_, i) => snap(`s${i}`, i));
    expect(selectSnapshotsToEvict(snapshots, now, { maxCount: 4, maxAgeDays: 7 }).sort()).toEqual(["s4", "s5"]);
  });

  it("evicts snapshots older than maxAgeDays but never the newest one", () => {
    const old = [snap("a", 24 * 10), snap("b", 24 * 9)];
    expect(selectSnapshotsToEvict(old, now)).toEqual(["a"]); // b is newer, so it is the protected newest
    expect(selectSnapshotsToEvict([snap("only", 24 * 30)], now)).toEqual([]);
  });

  it("protects the largest recent snapshot from a burst of small ones", () => {
    const snapshots = [snap("big", 10, 120), ...Array.from({ length: 5 }, (_, i) => snap(`small${i}`, i, 2))];
    const evicted = selectSnapshotsToEvict(snapshots, now, { maxCount: 3, maxAgeDays: 7 });
    expect(evicted).not.toContain("big");
    expect(evicted).not.toContain("small0");
    expect(snapshots.length - evicted.length).toBe(3);
  });

  it("handles empty input and is order-independent", () => {
    expect(selectSnapshotsToEvict([], now)).toEqual([]);
    const snapshots = Array.from({ length: 5 }, (_, i) => snap(`s${i}`, i));
    const policy = { maxCount: 2, maxAgeDays: 7 };
    expect(selectSnapshotsToEvict([...snapshots].reverse(), now, policy).sort()).toEqual(
      selectSnapshotsToEvict(snapshots, now, policy).sort(),
    );
  });
});

describe("diffSnapshotUrls", () => {
  it("counts added and removed urls including duplicates", () => {
    expect(diffSnapshotUrls(["a", "b", "b"], ["b", "c", "c"])).toEqual({ added: 2, removed: 2 });
    expect(diffSnapshotUrls([], ["a"])).toEqual({ added: 1, removed: 0 });
    expect(diffSnapshotUrls(["a"], ["a"])).toEqual({ added: 0, removed: 0 });
  });
});
