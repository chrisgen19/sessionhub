import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { tagCounts } from "@sessionhub/core/session-organize";
import { MasterDetail } from "../../components/master-detail";
import { NO_WORKSPACE } from "../../hooks/use-manager-route";
import { useSelection } from "../../hooks/use-selection";
import { useSessionList } from "../../hooks/use-session-list";
import { useSessions } from "../../hooks/use-sessions";
import { useWorkspaces } from "../../hooks/use-workspaces";
import { plural } from "../../lib/format";
import { WorkspaceSwitcher } from "../workspaces/workspace-switcher";
import { BulkBar } from "./bulk-bar";
import { ImportControl } from "./import-control";
import { ListControls } from "./list-controls";
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
  const list = useSessionList(inScope, query);
  const { selected, toggle, set } = useSelection();
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const session of all) {
      const key = workspaceOf(session.id) ?? NO_WORKSPACE;
      result[key] = (result[key] ?? 0) + 1;
    }
    return result;
  }, [all, workspaceOf]);
  const opened = all.find((session) => session.id === sessionId);
  const switcher = spaces?.connected && (spaces.syncEnabled || workspaces.length > 0);
  const order = list.visible.map((session) => session.id);
  const ticked = list.visible.filter((session) => selected.has(session.id));
  const inAccount = (id: string) => state.status === "ready" && (state.syncLabels[id] ?? "local") !== "local";
  // Suggestions offer every tag in use, whatever the list shows.
  const tagNames = useMemo(() => tagCounts(all).map((entry) => entry.tag), [all]);

  // A link to an archived session (from the popup or a bookmark) shows it beside the Archived list, once.
  const linked = useRef(false);
  const { setView } = list;
  useEffect(() => {
    if (linked.current || state.status !== "ready") return;
    linked.current = true;
    if (opened?.isArchived) setView("archived");
  }, [state.status, opened, setView]);

  return (
    <MasterDetail
      label="Saved sessions"
      emptyDetail="Select a session to see its windows and tabs."
      detail={
        opened && state.status === "ready" ? (
          <SessionInspector
            session={opened}
            syncLabel={state.syncLabels[opened.id] ?? "local"}
            workspaceId={state.workspaceIds[opened.id] ?? null}
            allTags={tagNames}
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
                {state.status === "ready" && <span className="hidden text-xs whitespace-nowrap tabular-nums text-fg-muted sm:inline">{plural(inScope.length, "session")}</span>}
              </div>
              <ImportControl onImported={onSelect} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-[min(100%,220px)] max-w-xl flex-1 items-center gap-2 rounded-lg border border-line bg-canvas px-3 focus-within:outline-2 focus-within:outline-focus xl:max-w-none">
                <Search aria-hidden="true" className="size-4 text-fg-muted" />
                <span className="sr-only">Search sessions, notes, tags, tab titles and URLs</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search sessions, tags and tabs"
                  className="h-9 w-full bg-transparent text-[13px] outline-none placeholder:text-fg-muted"
                />
              </label>
              {switcher && <WorkspaceSwitcher workspaces={workspaces} value={active} sessionCounts={counts} canCreate={spaces.syncEnabled} onChange={onWorkspace} />}
            </div>
            <ListControls
              view={list.view}
              counts={list.counts}
              onView={(view) => {
                setView(view);
                set([]);
              }}
              sort={list.sort}
              onSort={list.setSort}
              tags={list.tags}
              tag={list.tag}
              onTag={list.setTag}
            />
            <BulkBar
              selected={ticked}
              visibleCount={list.visible.length}
              archivedView={list.view === "archived"}
              workspaces={switcher && workspaces.length > 0 ? workspaces.filter((space) => space.sync.state !== "error") : null}
              tags={tagNames}
              inAccount={inAccount}
              onSelectAll={() => set([...selected, ...order])}
              onClear={() => set([])}
            />
          </header>
          <div className="bg-surface">
            <SessionList
              state={state}
              sessions={list.visible}
              selectedId={sessionId}
              searching={query.trim().length > 0}
              workspace={active === null ? null : active === NO_WORKSPACE ? "No workspace" : (names.get(active) ?? null)}
              workspaceName={(id) => {
                const assigned = workspaceOf(id);
                return active === null && assigned ? (names.get(assigned) ?? null) : null;
              }}
              checked={selected}
              onCheck={(id, range) => toggle(id, range, order)}
              archived={list.view === "archived"}
              tag={list.tag}
              onSelect={onSelect}
              onRetry={retry}
            />
          </div>
        </>
      }
    />
  );
}
