import { SESSION_LIMITS, type SavedSession } from "@sessionhub/contracts/session";
import { copyAsNewSession, type PrepareImportOptions } from "./session-import";

/**
 * Organizing saved sessions (docs/UI_UX_DESIGN.md 18p): notes, tags, pinned and archived, plus the
 * list's sorts. Absent fields read as empty: no notes or tags, not pinned, not archived.
 */

export class InvalidSessionDetailsError extends Error {
  override name = "InvalidSessionDetailsError";
}

/** A tag as stored: trimmed, inner spaces collapsed; throws when blank or too long. */
export const normalizeTag = (tag: string): string => {
  const clean = tag.trim().replace(/\s+/g, " ");
  if (clean.length === 0) throw new InvalidSessionDetailsError("A tag can't be empty");
  if (clean.length > SESSION_LIMITS.tagMax) throw new InvalidSessionDetailsError(`A tag must be ${SESSION_LIMITS.tagMax} characters or fewer`);
  return clean;
};

/** Tags compare without case: "Work" and "work" are the same tag. A plain key keeps lists of thousands cheap. */
const tagKey = (tag: string) => tag.toLowerCase();
const sameTag = (a: string, b: string) => tagKey(a) === tagKey(b);

/** Normalized tags without repeats (ignoring case; the first spelling stays); throws past the limit. */
export const normalizeTags = (tags: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags.map(normalizeTag)) {
    if (seen.has(tagKey(tag))) continue;
    seen.add(tagKey(tag));
    result.push(tag);
  }
  if (result.length > SESSION_LIMITS.tagsMax) throw new InvalidSessionDetailsError(`A session can have up to ${SESSION_LIMITS.tagsMax} tags`);
  return result;
};

/** Notes as stored: trimmed, null when empty; throws when too long. */
export const normalizeNotes = (notes: string | null): string | null => {
  const clean = notes?.trim() ?? "";
  if (clean.length > SESSION_LIMITS.descriptionMax) throw new InvalidSessionDetailsError(`Notes must be ${SESSION_LIMITS.descriptionMax} characters or fewer`);
  return clean.length > 0 ? clean : null;
};

export interface SessionDetails {
  description: string | null;
  tags: string[];
  isPinned: boolean;
  isArchived: boolean;
}

/** The session's organizing fields, with absent ones read as empty. */
export const detailsOf = (session: SavedSession): SessionDetails => ({
  description: session.description ?? null,
  tags: session.tags ?? [],
  isPinned: session.isPinned ?? false,
  isArchived: session.isArchived ?? false,
});

/**
 * A copy with the given fields changed (normalized) and a bumped version, or the same session when
 * nothing changes. Throws on invalid notes or tags.
 */
export const editSessionDetails = (session: SavedSession, patch: Partial<SessionDetails>, now: Date): SavedSession => {
  const current = detailsOf(session);
  const next: SessionDetails = {
    description: patch.description === undefined ? current.description : normalizeNotes(patch.description),
    tags: patch.tags === undefined ? current.tags : normalizeTags(patch.tags),
    isPinned: patch.isPinned ?? current.isPinned,
    isArchived: patch.isArchived ?? current.isArchived,
  };
  const changed =
    next.description !== current.description ||
    next.isPinned !== current.isPinned ||
    next.isArchived !== current.isArchived ||
    next.tags.length !== current.tags.length ||
    next.tags.some((tag, index) => tag !== current.tags[index]);
  if (!changed) return session;
  return { ...session, ...next, version: session.version + 1, updatedAt: now.toISOString() };
};

export const hasTag = (session: SavedSession, tag: string): boolean => (session.tags ?? []).some((own) => sameTag(own, tag));

/** Adds a tag unless the session already has it (ignoring case); throws past the limit. */
export const addTag = (session: SavedSession, tag: string, now: Date): SavedSession =>
  editSessionDetails(session, { tags: [...detailsOf(session).tags, tag] }, now);

export const removeTag = (session: SavedSession, tag: string, now: Date): SavedSession =>
  editSessionDetails(session, { tags: detailsOf(session).tags.filter((own) => !sameTag(own, tag)) }, now);

/** "Name (copy)", cut to fit the name limit. */
export const copyName = (name: string): string => {
  const suffix = " (copy)";
  return `${name.slice(0, SESSION_LIMITS.nameMax - suffix.length).trimEnd()}${suffix}`;
};

/**
 * A new session with the same tabs, notes and tags under "Name (copy)": fresh ids, version 1, saved
 * at `now`, neither pinned nor archived. The source device stays, as for any copy.
 */
export const duplicateSession = (session: SavedSession, options: PrepareImportOptions): SavedSession => ({
  ...copyAsNewSession(session, options),
  name: copyName(session.name),
  isPinned: false,
  isArchived: false,
});

export const SESSION_SORTS = ["updated", "oldest", "name", "tabs"] as const;
export type SessionSort = (typeof SESSION_SORTS)[number];

const tabCount = (session: SavedSession) => session.windows.reduce((sum, window) => sum + window.tabs.length, 0);
const byNewest = (a: SavedSession, b: SavedSession) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id);
const ORDER: Record<SessionSort, (a: SavedSession, b: SavedSession) => number> = {
  updated: byNewest,
  oldest: (a, b) => -byNewest(a, b),
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || byNewest(a, b),
  tabs: (a, b) => tabCount(b) - tabCount(a) || byNewest(a, b),
};

/** Pinned sessions first, each part in the chosen order. Returns a new array. */
export const sortSessions = <T extends SavedSession>(sessions: readonly T[], sort: SessionSort): T[] =>
  [...sessions].sort((a, b) => Number(b.isPinned ?? false) - Number(a.isPinned ?? false) || ORDER[sort](a, b));

/** Every tag in use with how many of the sessions have it, by name; the first spelling seen names it. */
export const tagCounts = (sessions: readonly SavedSession[]): { tag: string; count: number }[] => {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const session of sessions) {
    for (const tag of session.tags ?? []) {
      const entry = counts.get(tagKey(tag));
      if (entry) entry.count += 1;
      else counts.set(tagKey(tag), { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: "base", numeric: true }));
};
