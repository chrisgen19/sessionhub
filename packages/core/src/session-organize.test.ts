import { SESSION_LIMITS, type SavedSession } from "@sessionhub/contracts/session";
import { describe, expect, it } from "vitest";
import { buildSavedSession } from "./capture";
import { matchesSessionQuery } from "./search";
import { createSessionExport } from "./session-export";
import { parseSessionExport, prepareImportedSession } from "./session-import";
import {
  addTag,
  copyName,
  detailsOf,
  duplicateSession,
  editSessionDetails,
  InvalidSessionDetailsError,
  normalizeNotes,
  normalizeTags,
  removeTag,
  sortSessions,
  tagCounts,
} from "./session-organize";
import { duplicateTabIds, siteOf, topSites } from "./session-summary";
import { options, sequentialIds, tab } from "./test-helpers";

const now = new Date("2026-10-18T09:00:00.000Z");
const session = (name = "Research", urls = ["https://a.test/1"], extra: Partial<SavedSession> = {}): SavedSession => ({
  ...buildSavedSession([{ tabs: urls.map((url, index) => tab(index, url)), groups: [] }], options({ name, createId: sequentialIds() })).session,
  ...extra,
});

describe("tags and notes", () => {
  it("normalizes tags: trimmed, spaces collapsed, repeats dropped ignoring case (first spelling stays)", () => {
    expect(normalizeTags(["  Q4   planning ", "work", "WORK", "q4 planning"])).toEqual(["Q4 planning", "work"]);
  });

  it("refuses blank or overlong tags and more than the limit", () => {
    expect(() => normalizeTags([" "])).toThrow(InvalidSessionDetailsError);
    expect(() => normalizeTags(["x".repeat(SESSION_LIMITS.tagMax + 1)])).toThrow(InvalidSessionDetailsError);
    expect(() => normalizeTags(Array.from({ length: SESSION_LIMITS.tagsMax + 1 }, (_, index) => `t${index}`))).toThrow(/up to 10 tags/);
  });

  it("stores notes trimmed, and empty notes as none", () => {
    expect(normalizeNotes("  Read first \n")).toBe("Read first");
    expect(normalizeNotes("   ")).toBeNull();
    expect(() => normalizeNotes("x".repeat(SESSION_LIMITS.descriptionMax + 1))).toThrow(InvalidSessionDetailsError);
  });
});

describe("editSessionDetails", () => {
  it("reads absent fields as empty", () => {
    expect(detailsOf(session())).toEqual({ description: null, tags: [], isPinned: false, isArchived: false });
  });

  it("changes only what it's given, bumping the version and time", () => {
    const edited = editSessionDetails(session(), { isPinned: true, tags: ["work"] }, now);
    expect(edited).toMatchObject({ isPinned: true, isArchived: false, tags: ["work"], description: null, version: 2, updatedAt: now.toISOString() });
  });

  it("returns the same session when nothing changes, absent counting as empty", () => {
    const original = session();
    expect(editSessionDetails(original, { isArchived: false, tags: [], description: "  " }, now)).toBe(original);
    const tagged = session("R", undefined, { tags: ["work"] });
    expect(editSessionDetails(tagged, { tags: ["work"] }, now)).toBe(tagged);
  });

  it("adds a tag once and removes it ignoring case", () => {
    const tagged = addTag(session(), "Work", now);
    expect(addTag(tagged, "work", now)).toBe(tagged);
    expect(removeTag(tagged, "WORK", now).tags).toEqual([]);
    expect(() => addTag(session("R", undefined, { tags: Array.from({ length: 10 }, (_, index) => `t${index}`) }), "more", now)).toThrow(/up to 10/);
  });
});

describe("duplicateSession", () => {
  it("copies tabs, notes and tags under a new name with fresh ids, never pinned or archived", () => {
    const original = session("Research", ["https://a.test/1", "https://b.test/"], { description: "Notes", tags: ["work"], isPinned: true, isArchived: true });
    const copy = duplicateSession(original, { now, createId: sequentialIds() });
    expect(copy).toMatchObject({ name: "Research (copy)", description: "Notes", tags: ["work"], isPinned: false, isArchived: false, version: 1, createdAt: now.toISOString() });
    expect(copy.id).not.toBe(original.id);
    expect(copy.windows[0]!.tabs.map((t) => t.url)).toEqual(["https://a.test/1", "https://b.test/"]);
  });

  it("cuts a long name to fit", () => {
    expect(copyName("x".repeat(SESSION_LIMITS.nameMax))).toHaveLength(SESSION_LIMITS.nameMax);
  });
});

describe("sortSessions and tagCounts", () => {
  const a = session("beta", ["https://a.test/1"], { updatedAt: "2026-10-18T08:00:00.000Z" });
  const b = session("Alpha", ["https://a.test/1", "https://a.test/2", "https://a.test/3"], { updatedAt: "2026-10-17T08:00:00.000Z" });
  const c = session("Gamma 10", ["https://a.test/1", "https://a.test/2"], { updatedAt: "2026-10-16T08:00:00.000Z", isPinned: true });
  const names = (sessions: SavedSession[]) => sessions.map((s) => s.name);

  it("puts pinned sessions first, then the chosen order", () => {
    expect(names(sortSessions([a, b, c], "updated"))).toEqual(["Gamma 10", "beta", "Alpha"]);
    expect(names(sortSessions([a, b, c], "oldest"))).toEqual(["Gamma 10", "Alpha", "beta"]);
    expect(names(sortSessions([a, b, c], "name"))).toEqual(["Gamma 10", "Alpha", "beta"]);
    expect(names(sortSessions([a, b, c], "tabs"))).toEqual(["Gamma 10", "Alpha", "beta"]);
  });

  it("counts tags across sessions, ignoring case, by name", () => {
    const tagged = [session("1", undefined, { tags: ["work", "Reading"] }), session("2", undefined, { tags: ["Work"] }), session("3")];
    expect(tagCounts(tagged)).toEqual([{ tag: "Reading", count: 1 }, { tag: "work", count: 2 }]);
  });

  it("counts the most tags an account can hold quickly (5,000 sessions of 10 different tags)", () => {
    const many = Array.from({ length: 5000 }, (_, index) => ({ tags: Array.from({ length: 10 }, (_, n) => `tag ${index}-${n}`) }) as SavedSession);
    const started = performance.now();
    expect(tagCounts(many)).toHaveLength(50_000);
    // Was quadratic (1.25 billion comparisons); a keyed count takes milliseconds.
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("site summary", () => {
  it("names sites without www and skips addresses without a host", () => {
    expect(siteOf("https://www.github.com/x")).toBe("github.com");
    expect(siteOf("chrome://settings")).toBeNull();
    expect(siteOf("about:blank")).toBeNull();
    expect(siteOf("not a url")).toBeNull();
  });

  it("lists the sites with the most tabs and finds extra copies of the same address", () => {
    const s = session("S", ["https://a.test/1", "https://b.test/", "https://a.test/2", "https://a.test/1", "https://b.test/"]);
    expect(topSites(s)).toEqual([{ site: "a.test", count: 3 }, { site: "b.test", count: 2 }]);
    const tabs = s.windows[0]!.tabs;
    expect(duplicateTabIds(s)).toEqual(new Set([tabs[3]!.id, tabs[4]!.id]));
    // Among ticked tabs only: with the first copy unticked, the later one is the one that opens.
    expect(duplicateTabIds(s, new Set([tabs[1]!.id, tabs[3]!.id, tabs[4]!.id]))).toEqual(new Set([tabs[4]!.id]));
  });
});

describe("search, export and import", () => {
  it("search matches notes and tags", () => {
    const s = session("S", undefined, { description: "Quarterly review prep", tags: ["finance"] });
    expect(matchesSessionQuery(s, "quarterly")).toBe(true);
    expect(matchesSessionQuery(s, "finance")).toBe(true);
  });

  it("an import keeps notes and tags but is neither pinned nor archived", () => {
    const s = session("S", undefined, { description: "Notes", tags: ["work"], isPinned: true, isArchived: true });
    const file = parseSessionExport(JSON.stringify(createSessionExport(s, now)));
    const { session: imported } = prepareImportedSession(file, { now, createId: sequentialIds() });
    expect(imported).toMatchObject({ description: "Notes", tags: ["work"] });
    expect(imported).not.toHaveProperty("isPinned");
    expect(imported).not.toHaveProperty("isArchived");
  });
});
