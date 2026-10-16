import { Layers, MousePointerClick, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { filterSessions } from "@sessionhub/core/search";
import { BrandMark, SyncStatusChip } from "../../components/brand";
import { useSelectedSession } from "../../hooks/use-selected-session";
import { useSessions } from "../../hooks/use-sessions";
import { plural } from "../../lib/format";
import { ImportControl } from "./import-control";
import { SessionInspector } from "./session-inspector";
import { SessionList } from "./session-list";

/**
 * Full-page manager. >=1280px: nav | list | inspector. Narrower: the inspector replaces
 * the list as a detail view with a back button (docs/UI_UX_DESIGN.md section 7).
 */
export function ManagerApp() {
  const { state, retry } = useSessions();
  const [query, setQuery] = useState("");
  const [selectedId, select] = useSelectedSession();
  const searching = query.trim().length > 0;

  const sessions = useMemo(() => (state.status === "ready" ? filterSessions(state.sessions, query) : []), [state, query]);
  const selected = state.status === "ready" ? state.sessions.find((session) => session.id === selectedId) : undefined;
  const total = state.status === "ready" ? state.sessions.length : 0;

  return (
    <div className="min-h-screen bg-canvas text-fg lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:sticky lg:top-0 lg:h-screen lg:flex-col lg:items-stretch lg:justify-start lg:gap-7 lg:border-r lg:border-b-0 lg:px-3.5 lg:py-6">
        <div className="flex items-center gap-2.5 lg:px-2">
          <BrandMark />
          <span className="text-[17px] font-bold tracking-tight">SessionHub</span>
        </div>
        <nav aria-label="Manager" className="hidden lg:block">
          <a href="#" aria-current="page" className="flex items-center gap-2.5 rounded-lg bg-brand-soft px-3 py-2.5 text-[13px] font-semibold text-brand">
            <Layers aria-hidden="true" className="size-4" />
            Saved sessions
          </a>
        </nav>
        <div className="lg:mt-auto lg:space-y-2 lg:border-t lg:border-line lg:px-2 lg:pt-4">
          <SyncStatusChip />
          <p className="hidden text-[11px] leading-relaxed text-fg-muted lg:block">
            Saved in this browser only. Export important sessions to keep an independent backup.
          </p>
        </div>
      </aside>

      <div className="xl:grid xl:grid-cols-[minmax(420px,1fr)_400px]">
        <main className={`min-w-0 ${selected ? "hidden xl:block" : ""}`}>
          <header className="space-y-3 border-b border-line bg-surface px-4 py-5 lg:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h1 className="text-2xl font-bold tracking-tight">Saved sessions</h1>
                {state.status === "ready" && <span className="hidden text-xs whitespace-nowrap tabular-nums text-fg-muted sm:inline">{plural(total, "session")}</span>}
              </div>
              <ImportControl onImported={select} />
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
            <SessionList state={state} sessions={sessions} selectedId={selectedId} searching={searching} onSelect={select} onRetry={retry} />
          </div>
        </main>

        <section aria-label="Inspector" className={`min-w-0 border-line bg-surface xl:sticky xl:top-0 xl:h-screen xl:overflow-y-auto xl:border-l ${selected ? "" : "hidden xl:block"}`}>
          {selected ? (
            <SessionInspector session={selected} onBack={() => select(null)} onDeleted={() => select(null)} />
          ) : (
            <div className="grid h-full place-items-center p-8 text-center text-xs text-fg-muted">
              <div>
                <MousePointerClick aria-hidden="true" className="mx-auto mb-2 size-5" />
                Select a session to see its windows and tabs.
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
