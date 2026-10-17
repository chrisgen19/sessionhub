import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { filterSessions } from "@sessionhub/core/search";
import { MasterDetail } from "../../components/master-detail";
import { NO_WORKSPACE } from "../../hooks/use-manager-route";
import { useSessions } from "../../hooks/use-sessions";
import { useWorkspaces } from "../../hooks/use-workspaces";
import { plural } from "../../lib/format";
import { WorkspaceSwitcher } from "../workspaces/workspace-switcher";
import { ImportControl } from "./import-control";
import { SessionInspector } from "./session-inspector";
import { SessionList } from "./session-list";

interface SessionsViewProps {
  sessionId: string | null;
  /** A workspace id, NO_WORKSPACE, or null for all sessions. */
  workspace: string | null;
  onSelect: (id: string | null) => void;
  onWorkspace: (workspace: string | null) => void;
}

export function SessionsView({ sessionId, workspace, onSelect, onWorkspace }: SessionsViewProps) {
  const { state, retry } = useSessions();
  const spaces = useWorkspaces();
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const workspaces = useMemo(() => spaces?.workspaces ?? [], [spaces]);
  const names = useMemo(() => new Map(workspaces.map((space) => [space.id, space.name])), [workspaces]);
  // An unknown filter (deleted, or another account's link) shows everything.
  const active = workspace === NO_WORKSPACE || (workspace !== null && names.has(workspace)) ? workspace : null;

  /** The session's workspace as shown here: one this browser doesn't have counts as none. */
  const workspaceOf = useMemo(() => {
    const ids = state.status === "ready" ? state.workspaceIds : {};
    return (id: string) => {
      const assigned = ids[id] ?? null;
      return assigned !== null && names.has(assigned) ? assigned : null;
    };
  }, [state, names]);
  const all = useMemo(() => (state.status === "ready" ? state.sessions : []), [state]);
  const inScope = useMemo(() => (active === null ? all : all.filter((session) => (workspaceOf(session.id) ?? NO_WORKSPACE) === active)), [all, active, workspaceOf]);
  const sessions = useMemo(() => filterSessions(inScope, query), [inScope, query]);
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const session of all) {
      const key = workspaceOf(session.id) ?? NO_WORKSPACE;
      result[key] = (result[key] ?? 0) + 1;
    }
    return result;
  }, [all, workspaceOf]);
  const selected = all.find((session) => session.id === sessionId);
  const switcher = spaces?.connected && (spaces.syncEnabled || workspaces.length > 0);

  return (
    <MasterDetail
      label="Saved sessions"
      emptyDetail="Select a session to see its windows and tabs."
      detail={
        selected && state.status === "ready" ? (
          <SessionInspector
            session={selected}
            syncLabel={state.syncLabels[selected.id] ?? "local"}
            workspaceId={state.workspaceIds[selected.id] ?? null}
            onBack={() => onSelect(null)}
            onDeleted={() => onSelect(null)}
            onOpen={onSelect}
            query={query}
          />
        ) : null
      }
      list={
        <>
          {/* In the list rail (>=1280px) the header stays put while the sessions scroll under it. */}
          <header className="space-y-3 border-b border-line bg-surface px-4 py-5 lg:px-6 xl:sticky xl:top-0 xl:z-10 xl:px-4 xl:py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-baseline gap-3">
                <h1 className="text-2xl font-bold tracking-tight xl:text-xl">Saved sessions</h1>
                {state.status === "ready" && (
                  <span className="hidden text-xs whitespace-nowrap tabular-nums text-fg-muted sm:inline">{plural(inScope.length, "session")}</span>
                )}
              </div>
              <ImportControl onImported={onSelect} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-[min(100%,220px)] max-w-xl flex-1 items-center gap-2 rounded-lg border border-line bg-canvas px-3 focus-within:outline-2 focus-within:outline-focus xl:max-w-none">
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
              {switcher && <WorkspaceSwitcher workspaces={workspaces} value={active} sessionCounts={counts} canCreate={spaces.syncEnabled} onChange={onWorkspace} />}
            </div>
          </header>
          <div className="bg-surface">
            <SessionList
              state={state}
              sessions={sessions}
              selectedId={sessionId}
              searching={searching}
              workspace={active === null ? null : active === NO_WORKSPACE ? "No workspace" : (names.get(active) ?? null)}
              workspaceName={(id) => {
                const assigned = workspaceOf(id);
                return active === null && assigned ? (names.get(assigned) ?? null) : null;
              }}
              onSelect={onSelect}
              onRetry={retry}
            />
          </div>
        </>
      }
    />
  );
}
