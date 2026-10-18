import type { SavedSession } from "@sessionhub/contracts/session";

const tokenize = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);

const searchableText = (session: SavedSession): string =>
  [
    session.name,
    session.sourceDeviceName,
    session.description ?? "",
    ...(session.tags ?? []),
    ...session.windows.flatMap((window) => [
      ...window.groups.map((group) => group.title),
      ...window.tabs.flatMap((tab) => [tab.title, tab.url]),
    ]),
  ]
    .join("\n")
    .toLowerCase();

/** True when every whitespace-separated term appears in the session name, device, notes, tags, group, tab title or URL. */
export const matchesSessionQuery = (session: SavedSession, query: string): boolean => {
  const terms = tokenize(query);
  if (terms.length === 0) return true;
  const haystack = searchableText(session);
  return terms.every((term) => haystack.includes(term));
};

/** True when every term appears in the tab's title or URL (the open picker's "Select matches"). */
export const tabMatchesQuery = (tab: { title: string; url: string }, query: string): boolean => {
  const terms = tokenize(query);
  if (terms.length === 0) return false;
  const haystack = `${tab.title}\n${tab.url}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
};

/** Filters sessions by query, preserving input order. */
export const filterSessions = <T extends SavedSession>(sessions: readonly T[], query: string): T[] =>
  sessions.filter((session) => matchesSessionQuery(session, query));
