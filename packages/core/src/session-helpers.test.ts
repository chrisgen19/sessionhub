import { sessionExportSchema } from "@sessionhub/contracts/session-export";
import { describe, expect, it } from "vitest";
import { buildSavedSession } from "./capture";
import { defaultSessionName } from "./naming";
import { filterSessions, matchesSessionQuery } from "./search";
import { InvalidSessionNameError, renameSession } from "./session-edit";
import { createSessionExport, exportFileName } from "./session-export";
import { summarizeSession } from "./session-summary";
import { options, tab } from "./test-helpers";

const session = buildSavedSession(
  [
    {
      tabs: [tab(0, "https://github.com/acme/pull/42", { title: "Fix login PR" }), tab(1, "chrome://settings")],
      groups: [],
    },
  ],
  options({ name: "Client Alpha review" }),
).session;

describe("search", () => {
  it("matches name, tab title and url terms case-insensitively", () => {
    expect(matchesSessionQuery(session, "alpha")).toBe(true);
    expect(matchesSessionQuery(session, "LOGIN github")).toBe(true);
    expect(matchesSessionQuery(session, "pull/42")).toBe(true);
    expect(matchesSessionQuery(session, "alpha gitlab")).toBe(false);
  });

  it("treats a blank query as match-all", () => {
    expect(filterSessions([session], "   ")).toEqual([session]);
  });
});

describe("summarizeSession", () => {
  it("counts windows, tabs and restorable tabs", () => {
    expect(summarizeSession(session)).toEqual({ windowCount: 1, tabCount: 2, restorableTabCount: 1 });
  });
});

describe("renameSession", () => {
  const now = new Date("2026-10-17T00:00:00.000Z");

  it("trims, bumps version and updatedAt", () => {
    const renamed = renameSession(session, "  New name ", now);
    expect(renamed).toMatchObject({ name: "New name", version: 2, updatedAt: now.toISOString() });
    expect(session.version).toBe(1);
  });

  it("returns the same object when the name is unchanged", () => {
    expect(renameSession(session, "Client Alpha review", now)).toBe(session);
  });

  it("rejects blank and overlong names", () => {
    expect(() => renameSession(session, "  ", now)).toThrow(InvalidSessionNameError);
    expect(() => renameSession(session, "x".repeat(201), now)).toThrow(InvalidSessionNameError);
  });
});

describe("export helpers", () => {
  const now = new Date("2026-10-16T09:00:00.000Z");

  it("creates a schema-valid export", () => {
    expect(sessionExportSchema.safeParse(createSessionExport(session, now)).success).toBe(true);
  });

  it("builds a safe file name", () => {
    expect(exportFileName(session, now)).toBe("sessionhub-client-alpha-review-2026-10-16.json");
    expect(exportFileName({ ...session, name: "../../\u0000" }, now)).toBe("sessionhub-session-2026-10-16.json");
  });
});

describe("defaultSessionName", () => {
  it("formats window and all-window names", () => {
    const date = new Date("2026-10-16T01:42:00.000Z");
    expect(defaultSessionName("window", date, { timeZone: "UTC" })).toBe("Window, Oct 16, 1:42 AM");
    expect(defaultSessionName("all-windows", date, { timeZone: "UTC" })).toBe("All windows, Oct 16, 1:42 AM");
    expect(defaultSessionName("checkpoint", date, { timeZone: "UTC" })).toBe("Checkpoint, Oct 16, 1:42 AM");
  });
});
