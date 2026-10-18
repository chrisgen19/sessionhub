import { describe, expect, it } from "vitest";
import { SESSION_LIMITS, savedSessionSchema, type SavedSession } from "./session";
import { SESSION_EXPORT_FORMAT, sessionExportSchema } from "./session-export";

const ids = {
  session: "e16e808c-b32b-4fc5-a2c8-c1a04003024e",
  window: "170c8810-86e0-4417-a57b-04a3d31742e3",
  group: "4b0c1c52-7a4d-4a0e-9a59-6d5f1f1e2b3c",
  tab: "b7117d8d-9d95-4fae-b1b2-36d71d624b68",
  device: "0d6f6a4e-2f0c-4a43-8f5b-2a7e9a0c1d11",
};

function buildSession(): SavedSession {
  return {
    id: ids.session,
    schemaVersion: 1,
    name: "Frontend research",
    createdAt: "2026-10-16T08:00:00.000Z",
    updatedAt: "2026-10-16T08:00:00.000Z",
    sourceDeviceId: ids.device,
    sourceDeviceName: "This device",
    version: 1,
    windows: [
      {
        id: ids.window,
        sortOrder: 0,
        groups: [{ id: ids.group, title: "Docs", color: "blue", collapsed: false, sortOrder: 0 }],
        tabs: [
          {
            id: ids.tab,
            title: "TypeScript Docs",
            url: "https://www.typescriptlang.org/docs/",
            pinned: false,
            sortOrder: 0,
            groupId: ids.group,
            eligibility: "restorable",
          },
        ],
      },
    ],
  };
}

describe("savedSessionSchema", () => {
  it("accepts a well-formed session", () => {
    expect(savedSessionSchema.parse(buildSession())).toEqual(buildSession());
  });

  it("accepts a session with zero windows", () => {
    expect(savedSessionSchema.safeParse({ ...buildSession(), windows: [] }).success).toBe(true);
  });

  it("rejects a tab that references a group outside its window", () => {
    const session = buildSession();
    session.windows[0]!.groups = [];
    expect(savedSessionSchema.safeParse(session).success).toBe(false);
  });

  it("rejects duplicate ids across windows, groups and tabs", () => {
    const session = buildSession();
    session.windows[0]!.tabs[0]!.id = ids.window;
    expect(savedSessionSchema.safeParse(session).success).toBe(false);
  });

  it("rejects overlong titles and urls", () => {
    const longTitle = buildSession();
    longTitle.windows[0]!.tabs[0]!.title = "x".repeat(SESSION_LIMITS.titleMax + 1);
    expect(savedSessionSchema.safeParse(longTitle).success).toBe(false);

    const longUrl = buildSession();
    longUrl.windows[0]!.tabs[0]!.url = `https://a.test/${"x".repeat(SESSION_LIMITS.urlMax)}`;
    expect(savedSessionSchema.safeParse(longUrl).success).toBe(false);
  });

  it("rejects invalid ids, blank names and unknown schema versions", () => {
    expect(savedSessionSchema.safeParse({ ...buildSession(), id: "not-a-uuid" }).success).toBe(false);
    expect(savedSessionSchema.safeParse({ ...buildSession(), name: "   " }).success).toBe(false);
    expect(savedSessionSchema.safeParse({ ...buildSession(), schemaVersion: 2 }).success).toBe(false);
  });
});

describe("sessionExportSchema", () => {
  it("round-trips through JSON", () => {
    const file = {
      format: SESSION_EXPORT_FORMAT,
      schemaVersion: 1,
      exportedAt: "2026-10-16T09:00:00.000Z",
      session: buildSession(),
    };
    expect(sessionExportSchema.parse(JSON.parse(JSON.stringify(file)))).toEqual(file);
  });

  it("rejects a foreign format marker", () => {
    const file = {
      format: "other.export",
      schemaVersion: 1,
      exportedAt: "2026-10-16T09:00:00.000Z",
      session: buildSession(),
    };
    expect(sessionExportSchema.safeParse(file).success).toBe(false);
  });
});

describe("window state and bounds", () => {
  const withWindow = (extra: Record<string, unknown>) => {
    const session = buildSession();
    return { ...session, windows: [{ ...session.windows[0]!, ...extra }] };
  };

  it("are optional: sessions saved before them still validate", () => {
    expect(savedSessionSchema.safeParse(buildSession()).success).toBe(true);
  });

  it("accept a state and on-screen bounds, including negative coordinates on a second monitor", () => {
    const parsed = savedSessionSchema.parse(withWindow({ state: "normal", bounds: { left: -1920, top: 0, width: 1280, height: 800 } }));
    expect(parsed.windows[0]).toMatchObject({ state: "normal", bounds: { left: -1920, top: 0, width: 1280, height: 800 } });
    expect(savedSessionSchema.safeParse(withWindow({ state: "maximized" })).success).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ["minimized (stored as normal)", { state: "minimized" }],
    ["an unknown state", { state: "docked" }],
    ["a zero size", { bounds: { left: 0, top: 0, width: 0, height: 600 } }],
    ["a fractional coordinate", { bounds: { left: 1.5, top: 0, width: 800, height: 600 } }],
    ["a coordinate past the limit", { bounds: { left: SESSION_LIMITS.windowCoordinateMax + 1, top: 0, width: 800, height: 600 } }],
    ["a missing size", { bounds: { left: 0, top: 0, width: 800 } }],
    ["extra bounds fields", { bounds: { left: 0, top: 0, width: 800, height: 600, zoom: 2 } }],
  ])("reject %s", (_label, extra) => {
    expect(savedSessionSchema.safeParse(withWindow(extra)).success).toBe(false);
  });
});
