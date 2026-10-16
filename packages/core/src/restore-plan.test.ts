import { describe, expect, it } from "vitest";
import { buildSavedSession } from "./capture";
import { planRestore } from "./restore-plan";
import { options, tab } from "./test-helpers";

const sample = () =>
  buildSavedSession(
    [
      {
        tabs: [
          tab(0, "https://a.test", { groupKey: 1 }),
          tab(1, "chrome://settings"),
          tab(2, "https://pinned.test", { pinned: true }),
          tab(3, "https://b.test", { groupKey: 1 }),
        ],
        groups: [{ key: 1, title: "Dev", color: "green", collapsed: false }],
      },
      { tabs: [tab(0, "javascript:alert(1)")], groups: [] },
      { tabs: [tab(0, "https://c.test", { pinned: true, groupKey: 9 })], groups: [{ key: 9, title: "G", color: "red", collapsed: false }] },
    ],
    options(),
  ).session;

describe("planRestore", () => {
  it("opens one new window per saved window with restorable tabs, pinned first", () => {
    const plan = planRestore(sample());
    expect(plan.windows).toHaveLength(2);
    expect(plan.windows[0]!.tabs.map((t) => t.url)).toEqual(["https://pinned.test", "https://a.test", "https://b.test"]);
    expect(plan.tabCount).toBe(4);
  });

  it("lists every non-restorable tab with a reason and never plans it", () => {
    const plan = planRestore(sample());
    expect(plan.skipped.map((s) => [s.url, s.eligibility])).toEqual([
      ["chrome://settings", "browser-internal"],
      ["javascript:alert(1)", "unsafe"],
    ]);
    expect(plan.skipped.every((s) => s.reason.length > 0)).toBe(true);
    const planned = plan.windows.flatMap((w) => w.tabs.map((t) => t.url));
    expect(planned).not.toContain("javascript:alert(1)");
  });

  it("keeps group relationships and drops groups from pinned tabs", () => {
    const plan = planRestore(sample());
    const [first, second] = plan.windows;
    expect(first!.groups).toHaveLength(1);
    expect(first!.tabs.filter((t) => t.groupId === first!.groups[0]!.sourceGroupId)).toHaveLength(2);
    expect(second!.tabs[0]!.groupId).toBeNull();
    expect(second!.groups).toEqual([]);
  });

  it("restores only the selected tabs", () => {
    const session = sample();
    const target = session.windows[0]!.tabs[3]!;
    const plan = planRestore(session, { tabIds: new Set([target.id]) });
    expect(plan.windows).toHaveLength(1);
    expect(plan.windows[0]!.tabs.map((t) => t.sourceTabId)).toEqual([target.id]);
    expect(plan.skipped).toEqual([]);
  });

  it("returns an empty plan for an empty selection", () => {
    const plan = planRestore(sample(), { tabIds: new Set() });
    expect(plan).toMatchObject({ windows: [], skipped: [], tabCount: 0 });
  });

  it("re-classifies urls instead of trusting stored eligibility", () => {
    const session = sample();
    const tampered = session.windows[1]!.tabs[0]!;
    tampered.eligibility = "restorable";
    const plan = planRestore(session);
    expect(plan.windows.flatMap((w) => w.tabs.map((t) => t.url))).not.toContain("javascript:alert(1)");
    expect(plan.skipped.map((s) => s.sourceTabId)).toContain(tampered.id);
  });

  it("is deterministic", () => {
    const session = sample();
    expect(planRestore(session)).toEqual(planRestore(session));
  });
});
