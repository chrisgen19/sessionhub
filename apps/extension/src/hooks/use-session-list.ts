import { useMemo, useState } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { filterSessions } from "@sessionhub/core/search";
import { hasTag, sortSessions, tagCounts, type SessionSort } from "@sessionhub/core/session-organize";
import { readSessionSort, saveSessionSort } from "../lib/open-preferences";

export type ListView = "active" | "archived";

/**
 * The saved-session list as shown: Active or Archived, one tag, the search, then the sort (pinned
 * first). `sessions` are already limited to the chosen workspace. The sort is remembered per browser.
 */
export function useSessionList(sessions: readonly SavedSession[], query: string) {
  const [view, setView] = useState<ListView>("active");
  const [sort, setSort] = useState<SessionSort>(readSessionSort);
  const [tag, setTag] = useState<string | null>(null);

  return useMemo(() => {
    const archived = sessions.filter((session) => session.isArchived === true);
    const inView = view === "archived" ? archived : sessions.filter((session) => session.isArchived !== true);
    const tags = tagCounts(inView);
    // A tag no session in this view has any more (removed, or another view) shows everything.
    const activeTag = tag !== null && inView.some((session) => hasTag(session, tag)) ? tag : null;
    const tagged = activeTag === null ? inView : inView.filter((session) => hasTag(session, activeTag));
    return {
      view,
      setView,
      sort,
      setSort: (next: SessionSort) => {
        setSort(next);
        saveSessionSort(next);
      },
      tag: activeTag,
      setTag,
      tags,
      counts: { active: sessions.length - archived.length, archived: archived.length },
      visible: sortSessions(filterSessions(tagged, query), sort),
    };
  }, [sessions, query, view, sort, tag]);
}
