import { ExternalLink, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { browser } from "wxt/browser";
import { filterSessions } from "@sessionhub/core/search";
import { BrandMark } from "../../components/brand";
import { SyncStatusChip } from "../../components/sync-status-chip";
import { ThemeToggle } from "../../components/theme-toggle";
import { useSessions } from "../../hooks/use-sessions";
import { SavePanel } from "../save/save-panel";
import { RecentSessions } from "./recent-sessions";

const RECENT_LIMIT = 5;
const SEARCH_LIMIT = 20;

/** Opens the manager in a tab: on a session, on a view (`#view=open-tabs`), or its start page. */
const openManager = async (hash = "") => {
  await browser.tabs.create({ url: `${browser.runtime.getURL("/manager.html")}${hash}` });
  window.close();
};

export function PopupApp() {
  const { state, retry } = useSessions();
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  const visible = useMemo(() => {
    if (state.status !== "ready") return [];
    return searching ? filterSessions(state.sessions, query).slice(0, SEARCH_LIMIT) : state.sessions.slice(0, RECENT_LIMIT);
  }, [state, query, searching]);

  return (
    <div className="flex w-[380px] flex-col bg-surface text-fg">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <BrandMark size="sm" />
          <h1 className="text-[15px] font-bold tracking-tight">SessionHub</h1>
        </div>
        <div className="flex items-center gap-2">
          <SyncStatusChip />
          <ThemeToggle />
        </div>
      </header>

      <main className="space-y-4 px-4 py-4">
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

        <section aria-labelledby="save-heading">
          <div className="mb-1.5 flex items-center justify-between">
            <h2 id="save-heading" className="text-[13px] font-semibold">
              Save tabs
            </h2>
            <button type="button" onClick={() => void openManager("#view=open-tabs")} className="text-xs font-semibold text-brand hover:underline">
              Open full view
            </button>
          </div>
          <SavePanel variant="popup" />
        </section>

        <section aria-labelledby="recent-heading">
          <div className="mb-1.5 flex items-center justify-between">
            <h2 id="recent-heading" className="text-[13px] font-semibold">
              {searching ? "Matching sessions" : "Recent sessions"}
            </h2>
            <button type="button" onClick={() => void openManager()} className="text-xs font-semibold text-brand hover:underline">
              View all
            </button>
          </div>
          <RecentSessions state={state} sessions={visible} searching={searching} onOpen={(id) => void openManager(`#session=${id}`)} onRetry={retry} />
        </section>
      </main>

      <footer className="border-t border-line bg-canvas px-4 py-3">
        <button
          type="button"
          onClick={() => void openManager()}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-line bg-surface text-[13px] font-semibold hover:bg-surface-muted"
        >
          <ExternalLink aria-hidden="true" className="size-4" />
          Open manager
        </button>
      </footer>
    </div>
  );
}
