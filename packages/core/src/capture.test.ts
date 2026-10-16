import { savedSessionSchema } from "@sessionhub/contracts/session";
import { describe, expect, it } from "vitest";
import { buildSavedSession, CaptureLimitError } from "./capture";
import { options, tab } from "./test-helpers";

describe("buildSavedSession", () => {
  it("produces a schema-valid session with fresh UUIDs and no runtime ids", () => {
    const { session, report } = buildSavedSession(
      [
        {
          tabs: [tab(0, "https://a.test"), tab(1, "https://b.test", { groupKey: 731 })],
          groups: [{ key: 731, title: "Dev", color: "blue", collapsed: true }],
        },
        { tabs: [tab(0, "https://c.test", { pinned: true })], groups: [] },
      ],
      options(),
    );

    expect(savedSessionSchema.safeParse(session).success).toBe(true);
    expect(report).toMatchObject({ windowCount: 2, tabCount: 3, emptyWindowsSkipped: 0 });
    expect(JSON.stringify(session)).not.toContain("731");
    const [first] = session.windows;
    expect(first!.groups).toEqual([
      expect.objectContaining({ title: "Dev", color: "blue", collapsed: true, sortOrder: 0 }),
    ]);
    expect(first!.tabs[1]!.groupId).toBe(first!.groups[0]!.id);
    expect(session.windows[1]!.tabs[0]!.pinned).toBe(true);
  });

  it("orders tabs by browser index and preserves duplicate urls", () => {
    const { session } = buildSavedSession(
      [{ tabs: [tab(2, "https://x.test"), tab(0, "https://x.test"), tab(1, "https://y.test")], groups: [] }],
      options(),
    );
    const tabs = session.windows[0]!.tabs;
    expect(tabs.map((t) => t.title)).toEqual(["Tab 0", "Tab 1", "Tab 2"]);
    expect(tabs.map((t) => t.sortOrder)).toEqual([0, 1, 2]);
  });

  it("keeps restricted tabs as metadata and reports them", () => {
    const { session, report } = buildSavedSession(
      [
        {
          tabs: [tab(0, "chrome://newtab/"), tab(1, "file:///tmp/a.txt"), tab(2, "https://ok.test")],
          groups: [],
        },
      ],
      options(),
    );
    expect(session.windows[0]!.tabs.map((t) => t.eligibility)).toEqual([
      "browser-internal",
      "local-file",
      "restorable",
    ]);
    expect(report.notRestorable).toEqual({ "browser-internal": 1, "local-file": 1 });
  });

  it("skips empty windows and handles zero windows", () => {
    expect(buildSavedSession([{ tabs: [], groups: [] }], options()).report.emptyWindowsSkipped).toBe(1);
    const { session } = buildSavedSession([], options());
    expect(session.windows).toEqual([]);
    expect(savedSessionSchema.safeParse(session).success).toBe(true);
  });

  it("drops groups with no tabs, orders groups by first tab and maps unknown colors to grey", () => {
    const { session } = buildSavedSession(
      [
        {
          tabs: [tab(0, "https://a.test", { groupKey: 2 }), tab(1, "https://b.test", { groupKey: 1 })],
          groups: [
            { key: 1, title: "Second", color: "magenta", collapsed: false },
            { key: 2, title: "First", color: "red", collapsed: false },
            { key: 3, title: "Unused", color: "red", collapsed: false },
          ],
        },
      ],
      options(),
    );
    const groups = session.windows[0]!.groups;
    expect(groups.map((g) => [g.title, g.color, g.sortOrder])).toEqual([
      ["First", "red", 0],
      ["Second", "grey", 1],
    ]);
  });

  it("truncates overlong titles instead of failing", () => {
    const { session } = buildSavedSession(
      [{ tabs: [tab(0, "https://a.test", { title: "t".repeat(5000) })], groups: [] }],
      options(),
    );
    expect(session.windows[0]!.tabs[0]!.title).toHaveLength(1024);
    expect(savedSessionSchema.safeParse(session).success).toBe(true);
  });

  it("throws a typed error when a window exceeds the tab limit", () => {
    const tabs = Array.from({ length: 2001 }, (_, i) => tab(i, "https://a.test"));
    expect(() => buildSavedSession([{ tabs, groups: [] }], options())).toThrow(CaptureLimitError);
  });

  it("handles a 500-tab capture", () => {
    const tabs = Array.from({ length: 500 }, (_, i) => tab(i, `https://site${i}.test`));
    const { session, report } = buildSavedSession([{ tabs, groups: [] }], options());
    expect(report.tabCount).toBe(500);
    expect(savedSessionSchema.safeParse(session).success).toBe(true);
  });
});
