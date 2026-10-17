import { describe, expect, it } from "vitest";
import { buildSavedSession } from "./capture";
import { planRestore, planRetry, withoutOpenTabs } from "./restore-plan";
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

/** Two windows, each with a group; the second has a pinned tab after an unpinned one. */
const twoWindows = () =>
  buildSavedSession(
    [
      {
        tabs: [tab(0, "https://a.test", { groupKey: 1 }), tab(1, "https://b.test")],
        groups: [{ key: 1, title: "Dev", color: "green", collapsed: false }],
      },
      {
        tabs: [tab(0, "https://c.test"), tab(1, "https://d.test", { pinned: true }), tab(2, "https://e.test", { groupKey: 2 })],
        groups: [{ key: 2, title: "Docs", color: "blue", collapsed: true }],
      },
    ],
    options(),
  ).session;

const urls = (plan: ReturnType<typeof planRestore>) => plan.windows.map((window) => window.tabs.map((tab) => tab.url));

describe("planRestore with layout single", () => {
  it("puts every window's tabs in one window: window order, pinned first overall, every group kept", () => {
    const session = twoWindows();
    const plan = planRestore(session, { layout: "single" });
    expect(urls(plan)).toEqual([["https://d.test", "https://a.test", "https://b.test", "https://c.test", "https://e.test"]]);
    expect(plan.windows[0]!.groups.map((group) => group.title)).toEqual(["Dev", "Docs"]);
    expect(plan.windows[0]!.sourceWindowId).toBe(session.windows[0]!.id);
    expect(plan.tabCount).toBe(5);
  });

  it("keeps skipped tabs and matches the original layout when only one window has tabs", () => {
    const merged = planRestore(sample(), { layout: "single" });
    expect(merged.skipped).toEqual(planRestore(sample()).skipped);
    expect(urls(merged)).toEqual([["https://pinned.test", "https://c.test", "https://a.test", "https://b.test"]]);

    const session = twoWindows();
    const secondOnly = { tabIds: new Set(session.windows[1]!.tabs.map((t) => t.id)) };
    expect(planRestore(session, { ...secondOnly, layout: "single" })).toEqual(planRestore(session, secondOnly));
  });
});

describe("withoutOpenTabs", () => {
  it("leaves out tabs whose exact url is open, lists them, and drops groups and windows left empty", () => {
    const plan = withoutOpenTabs(planRestore(twoWindows()), new Set(["https://a.test", "https://c.test", "https://d.test", "https://e.test/other"]));
    expect(urls(plan)).toEqual([["https://b.test"], ["https://e.test"]]);
    expect(plan.windows[0]!.groups).toEqual([]);
    expect(plan.windows[1]!.groups.map((group) => group.title)).toEqual(["Docs"]);
    expect(plan.alreadyOpen?.map((tab) => tab.url)).toEqual(["https://a.test", "https://d.test", "https://c.test"]);
    expect(plan.tabCount).toBe(2);
  });

  it("plans nothing when every tab is already open, and a retry never reopens them", () => {
    const original = planRestore(twoWindows(), { layout: "single" });
    const all = withoutOpenTabs(original, new Set(urls(original).flat()));
    expect(all).toMatchObject({ windows: [], tabCount: 0 });
    expect(all.alreadyOpen).toHaveLength(5);

    const some = withoutOpenTabs(original, new Set(["https://b.test"]));
    const retry = planRetry(some, new Set());
    expect(urls(retry).flat()).not.toContain("https://b.test");
    expect(retry).not.toHaveProperty("alreadyOpen");
  });
});

describe("planRetry", () => {
  it("keeps only tabs that never opened, with their groups, in original order", () => {
    const plan = planRestore(sample());
    const [first, second] = plan.windows;
    // a.test (grouped) and the second window's tab failed; pinned + b.test opened.
    const opened = new Set([first!.tabs[0]!.sourceTabId, first!.tabs[2]!.sourceTabId]);
    const retry = planRetry(plan, opened);

    expect(retry.windows.map((w) => w.tabs.map((t) => t.url))).toEqual([["https://a.test"], ["https://c.test"]]);
    expect(retry.windows[0]!.groups.map((g) => g.title)).toEqual(["Dev"]);
    expect(retry.tabCount).toBe(2);
    expect(retry.skipped).toEqual([]);
    expect(retry.windows.flatMap((w) => w.tabs.map((t) => t.sourceTabId)).some((id) => opened.has(id))).toBe(false);
    expect(second!.tabs).toHaveLength(1);
  });

  it("drops groups and windows with nothing left, and is empty when everything opened", () => {
    const plan = planRestore(sample());
    const all = new Set(plan.windows.flatMap((w) => w.tabs.map((t) => t.sourceTabId)));
    expect(planRetry(plan, all)).toMatchObject({ windows: [], tabCount: 0 });

    const firstWindowOpened = new Set(plan.windows[0]!.tabs.map((t) => t.sourceTabId));
    const retry = planRetry(plan, firstWindowOpened);
    expect(retry.windows).toHaveLength(1);
    expect(retry.windows[0]!.sourceWindowId).toBe(plan.windows[1]!.sourceWindowId);
  });

  it("re-checks urls stored in the plan", () => {
    const plan = planRestore(sample());
    plan.windows[1]!.tabs[0]!.url = "javascript:alert(1)";
    expect(planRetry(plan, new Set()).windows.flatMap((w) => w.tabs.map((t) => t.url))).not.toContain("javascript:alert(1)");
  });
});

