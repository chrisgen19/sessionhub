import { savedSessionSchema } from "@sessionhub/contracts/session";
import { describe, expect, it } from "vitest";
import { buildSavedSession } from "./capture";
import { createSessionExport } from "./session-export";
import { IMPORT_MAX_BYTES, parseSessionExport, prepareImportedSession, SessionImportError } from "./session-import";
import { options, sequentialIds, tab } from "./test-helpers";

const original = () =>
  buildSavedSession(
    [
      {
        tabs: [
          tab(0, "https://a.test", { pinned: true }),
          tab(1, "https://b.test", { groupKey: 4 }),
          tab(2, "https://c.test", { groupKey: 4 }),
          tab(3, "chrome://settings"),
        ],
        groups: [{ key: 4, title: "Docs", color: "cyan", collapsed: true }],
      },
      { tabs: [tab(0, "https://d.test")], groups: [] },
    ],
    options({ name: "Client Alpha" }),
  ).session;

const exportText = (mutate?: (file: Record<string, unknown> & { session: ReturnType<typeof original> }) => void) => {
  const file = createSessionExport(original(), new Date("2026-10-16T09:00:00.000Z"));
  mutate?.(file as never);
  return JSON.stringify(file);
};

const importError = (text: string) => {
  try {
    parseSessionExport(text);
  } catch (error) {
    return error instanceof SessionImportError ? error.code : "other";
  }
  return "none";
};

/** Ids from a different range than the fixture's, like crypto.randomUUID would be. */
const importIds = (): (() => string) => {
  const next = sequentialIds();
  return () => next().replace(/^00000000/, "11111111");
};

const prepare = (text: string) =>
  prepareImportedSession(parseSessionExport(text), {
    now: new Date("2026-10-17T00:00:00.000Z"),
    createId: importIds(),
  });

describe("parseSessionExport", () => {
  it("accepts a current export", () => {
    expect(parseSessionExport(exportText()).session.name).toBe("Client Alpha");
  });

  it.each([
    ["not json", "{nope", "not-json"],
    ["a JSON array", "[]", "wrong-format"],
    ["another app's file", JSON.stringify({ format: "other", schemaVersion: 1 }), "wrong-format"],
    ["a newer format", exportText((file) => (file.schemaVersion = 2)), "unsupported-version"],
    ["a zero version", exportText((file) => (file.schemaVersion = 0)), "invalid-structure"],
    ["an invalid uuid", exportText((file) => (file.session.id = "123")), "invalid-structure"],
    ["an overlong title", exportText((file) => (file.session.windows[0]!.tabs[0]!.title = "x".repeat(1025))), "invalid-structure"],
    ["a dangling group reference", exportText((file) => (file.session.windows[0]!.groups = [])), "invalid-structure"],
    ["duplicate ids", exportText((file) => (file.session.windows[1]!.id = file.session.windows[0]!.id)), "invalid-structure"],
  ])("rejects %s", (_label, text, code) => {
    expect(importError(text)).toBe(code);
  });

  it("rejects oversized files before parsing", () => {
    expect(importError(" ".repeat(IMPORT_MAX_BYTES + 1))).toBe("too-large");
  });

  it("gives a readable message with the failing path", () => {
    expect(() => parseSessionExport(exportText((file) => (file.session.id = "123")))).toThrow(/at session\.id/);
  });
});

describe("prepareImportedSession", () => {
  it("assigns fresh ids everywhere and keeps group links", () => {
    const source = original();
    const { session } = prepare(exportText());
    const oldIds = new Set([source.id, ...source.windows.flatMap((w) => [w.id, ...w.groups.map((g) => g.id), ...w.tabs.map((t) => t.id)])]);
    const newIds = [session.id, ...session.windows.flatMap((w) => [w.id, ...w.groups.map((g) => g.id), ...w.tabs.map((t) => t.id)])];
    expect(newIds.filter((id) => oldIds.has(id))).toEqual([]);
    const [first] = session.windows;
    expect(first!.tabs.filter((t) => t.groupId === first!.groups[0]!.id)).toHaveLength(2);
    expect(savedSessionSchema.safeParse(session).success).toBe(true);
  });

  it("marks the session as imported with a fresh version and timestamps", () => {
    const { session } = prepare(exportText());
    expect(session).toMatchObject({
      name: "Client Alpha",
      sourceDeviceId: null,
      sourceDeviceName: "This device",
      version: 1,
      createdAt: "2026-10-17T00:00:00.000Z",
      updatedAt: "2026-10-17T00:00:00.000Z",
    });
  });

  it("re-classifies urls instead of trusting the file", () => {
    const { session, report } = prepare(
      exportText((file) => {
        const target = file.session.windows[1]!.tabs[0]!;
        target.url = "javascript:alert(document.cookie)";
        target.eligibility = "restorable";
      }),
    );
    expect(session.windows[1]!.tabs[0]!.eligibility).toBe("unsafe");
    expect(report).toMatchObject({ reclassifiedCount: 1, notRestorable: { unsafe: 1, "browser-internal": 1 } });
  });

  it("normalizes duplicated or gapped ordering deterministically", () => {
    const { session } = prepare(
      exportText((file) => {
        const tabs = file.session.windows[0]!.tabs;
        tabs[0]!.sortOrder = 7;
        tabs[1]!.sortOrder = 3;
        tabs[2]!.sortOrder = 3;
        tabs[3]!.sortOrder = 0;
      }),
    );
    expect(session.windows[0]!.tabs.map((t) => [t.url, t.sortOrder])).toEqual([
      ["chrome://settings", 0],
      ["https://b.test", 1],
      ["https://c.test", 2],
      ["https://a.test", 3],
    ]);
  });

  it("drops empty windows and rejects files without tabs", () => {
    const { report } = prepare(exportText((file) => file.session.windows.push({ id: "00000000-0000-4000-8000-0000000000ff", sortOrder: 5, groups: [], tabs: [] })));
    expect(report.windowCount).toBe(2);
    expect(() => prepare(exportText((file) => (file.session.windows = [])))).toThrow(SessionImportError);
  });

  it("round-trips an export into an equivalent session", () => {
    const source = original();
    const { session } = prepare(JSON.stringify(createSessionExport(source, new Date())));
    const shape = (s: typeof source) => s.windows.map((w) => w.tabs.map((t) => [t.url, t.title, t.pinned, t.eligibility]));
    expect(shape(session)).toEqual(shape(source));
  });
});
