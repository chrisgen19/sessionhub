import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { filterSessions } from "@sessionhub/core/search";
import { MasterDetail } from "../../components/master-detail";
import { useSessions } from "../../hooks/use-sessions";
import { plural } from "../../lib/format";
import { ImportControl } from "./import-control";
import { SessionInspector } from "./session-inspector";
import { SessionList } from "./session-list";

export function SessionsView({ sessionId, onSelect }: { sessionId: string | null; onSelect: (id: string | null) => void }) {
  const { state, retry } = useSessions();
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  const sessions = useMemo(() => (state.status === "ready" ? filterSessions(state.sessions, query) : []), [state, query]);
  const selected = state.status === "ready" ? state.sessions.find((session) => session.id === sessionId) : undefined;
  const total = state.status === "ready" ? state.sessions.length : 0;

  return (
    <MasterDetail
      label="Saved sessions"
      emptyDetail="Select a session to see its windows and tabs."
      detail={
        selected && state.status === "ready" ? (
          <SessionInspector
            session={selected}
            syncLabel={state.syncLabels[selected.id] ?? "local"}
            onBack={() => onSelect(null)}
            onDeleted={() => onSelect(null)}
            onOpen={onSelect}
          />
        ) : null
      }
      list={
        <>
          <header className="space-y-3 border-b border-line bg-surface px-4 py-5 lg:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h1 className="text-2xl font-bold tracking-tight">Saved sessions</h1>
                {state.status === "ready" && (
                  <span className="hidden text-xs whitespace-nowrap tabular-nums text-fg-muted sm:inline">{plural(total, "session")}</span>
                )}
              </div>
              <ImportControl onImported={onSelect} />
            </div>
            <label className="flex max-w-xl items-center gap-2 rounded-lg border border-line bg-canvas px-3 focus-within:outline-2 focus-within:outline-focus">
              <Search aria-hidden="true" className="size-4 text-fg-muted" />
              <span className="sr-only">Search sessions, tab titles and URLs</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search sessions, tab titles and URLs"
                className="h-9 w-full bg-transparent text-[13px] outline-none placeholder:text-fg-muted"
              />
            </label>
          </header>
          <div className="bg-surface">
            <SessionList state={state} sessions={sessions} selectedId={sessionId} searching={searching} onSelect={onSelect} onRetry={retry} />
          </div>
        </>
      }
    />
  );
}
