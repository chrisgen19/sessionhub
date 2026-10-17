import { filterSessions } from "@sessionhub/core/search";
import { ArrowLeft, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { SessionsState } from "../../hooks/use-sessions";
import { readOpenLazy, readOpenTarget, readSkipOpen, saveOpenTarget } from "../../lib/open-preferences";
import { DESTINATION_PHRASE } from "../open/open-bar";
import { OpenPanel } from "../open/open-panel";
import { RecentSessions } from "./recent-sessions";

/** The list scrolls inside the popup, so it can show more than the old five. */
const LIST_LIMIT = 20;

interface OpenTabProps {
  state: SessionsState;
  onRetry: () => void;
  /** Opens the manager in a tab, on a session (`#session=<id>`) or its start page. */
  onOpenManager: (hash?: string) => void;
}

/**
 * The popup's Open tab (docs/UI_UX_DESIGN.md 18k): search, recent sessions with an Open button each
 * (the whole session, where the user opened last), and a session's own tree to choose tabs.
 */
export function OpenTab({ state, onRetry, onOpenManager }: OpenTabProps) {
  const [query, setQuery] = useState("");
  const [shownId, setShownId] = useState<string | null>(null);
  const [destination, setDestination] = useState(readOpenTarget);
  const searching = query.trim().length > 0;
  // Read on each render: the open picker may change them while a session is shown.
  const lazy = readOpenLazy();

  const visible = useMemo(() => {
    if (state.status !== "ready") return [];
    return (searching ? filterSessions(state.sessions, query) : state.sessions).slice(0, LIST_LIMIT);
  }, [state, query, searching]);
  const shown = state.status === "ready" ? state.sessions.find((session) => session.id === shownId) : undefined;

  if (shown) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => {
            setShownId(null);
            // The tree's own menu may have changed it.
            setDestination(readOpenTarget());
          }}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          All sessions
        </button>
        <h2 className="text-[15px] font-bold tracking-tight break-words">{shown.name}</h2>
        <OpenPanel key={shown.id} session={shown} query={query} variant="popup" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 -mx-4 -mt-3 bg-surface px-4 pt-3 pb-1">
        <label className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 focus-within:outline-2 focus-within:outline-focus">
          <Search aria-hidden="true" className="size-4 text-fg-muted" />
          <span className="sr-only">Search saved sessions</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search saved sessions and tabs"
            className="h-9 w-full bg-transparent text-[13px] outline-none placeholder:text-fg-muted"
          />
        </label>
      </div>
      <section aria-labelledby="recent-heading">
        <div className="flex items-center justify-between">
          <h2 id="recent-heading" className="text-[13px] font-semibold">
            {searching ? "Matching sessions" : "Recent sessions"}
          </h2>
          <button type="button" onClick={() => onOpenManager()} className="text-xs font-semibold text-brand hover:underline">
            View all
          </button>
        </div>
        <p className="mb-1 text-[11px] text-fg-muted">
          Open puts all of a session&apos;s tabs {DESTINATION_PHRASE[destination]}
          {lazy ? ", unloaded until clicked" : ""}. Tap a session to choose tabs.
        </p>
        <RecentSessions
          state={state}
          sessions={visible}
          searching={searching}
          destination={destination}
          onDestination={(next) => {
            setDestination(next);
            saveOpenTarget(next);
          }}
          skipOpen={readSkipOpen()}
          lazy={lazy}
          onShow={setShownId}
          onDetails={(id) => onOpenManager(`#session=${id}`)}
          onRetry={onRetry}
        />
      </section>
    </div>
  );
}
