import { Archive, FolderOpen, Layers, Pin, SearchX } from "lucide-react";
import Link from "next/link";
import { getPrisma } from "@sessionhub/database/client";
import { ColorDot } from "@/components/dashboard/color-dot";
import { EmptyState } from "@/components/dashboard/page-parts";
import { WorkspaceFilter } from "@/components/dashboard/workspace-filter";
import { formatRelative, plural } from "@/lib/format";
import { NO_WORKSPACE, parseWorkspaceFilter, sessionsHref, type SessionsQuery } from "@/lib/workspace-filter";
import { listSessions, listWorkspaceFilters, SESSION_LIST_LIMIT, type SessionListItem, type WorkspaceChoice } from "@/server/queries/dashboard";
import { SessionSearch } from "./session-search";
import { SessionTags } from "./session-tags";

interface SessionsRailProps {
  /** From the validated server session, never from the URL. */
  userId: string;
  request: SessionsQuery;
  /** The session open beside the list; its title is then the page's h1 and this list's heading an h2. */
  selectedId?: string;
}

function ViewTabs({ archived, query, workspace }: { archived: boolean; query: string; workspace: string | null }) {
  const tab = (view: "active" | "archived", label: string, current: boolean) => (
    <Link
      href={sessionsHref({ archived: view === "archived", query, workspace })}
      aria-current={current ? "page" : undefined}
      className={`rounded-md px-2.5 py-1 text-xs font-semibold ${current ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Session views" className="inline-flex shrink-0 rounded-lg bg-surface-muted p-0.5">
      {tab("active", "Active", !archived)}
      {tab("archived", "Archived", archived)}
    </nav>
  );
}

const describe = (query: string, scope: string | null) => {
  if (query) return `Results for “${query}”${scope ? ` ${scope}` : ""}`;
  return scope ? `Sessions ${scope}.` : "Sessions synced to your account from your browsers.";
};

interface ListProps {
  sessions: SessionListItem[];
  selectedId?: string;
  linkFor: (id: string) => string;
  /** Names each row's workspace; left out where the list is already one workspace. */
  workspaces?: ReadonlyMap<string, WorkspaceChoice>;
}

/** Name and date on the first line; workspace, tabs and source on the second. Dates never shrink away. */
function SessionRows({ sessions, selectedId, linkFor, workspaces }: ListProps) {
  const now = new Date();
  return (
    <ul aria-label="Saved sessions" className="divide-y divide-line">
      {sessions.map((session) => {
        const workspace = session.workspaceId ? workspaces?.get(session.workspaceId) : undefined;
        const selected = session.id === selectedId;
        return (
          <li key={session.id}>
            <Link
              href={linkFor(session.id)}
              aria-current={selected ? "page" : undefined}
              className={`block space-y-0.5 px-4 py-3 hover:bg-surface-muted lg:px-6 xl:px-4 ${selected ? "bg-brand-soft shadow-[inset_3px_0_0_var(--sh-brand)]" : ""}`}
            >
              <span className="flex items-baseline gap-3">
                <span className="flex min-w-0 flex-1 items-center gap-1 text-[13px] font-semibold">
                  {session.isPinned && (
                    <>
                      <Pin aria-hidden="true" className="size-3 shrink-0 text-brand" />
                      <span className="sr-only">Pinned: </span>
                    </>
                  )}
                  <span className="truncate" title={session.name}>
                    {session.name}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-fg-muted">{formatRelative(session.updatedAt, now)}</span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
                {workspace && (
                  <>
                    <ColorDot color={workspace.color} />
                    <span className="max-w-[45%] truncate font-semibold text-fg">{workspace.name}</span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <span className="truncate">
                  {plural(session.tabCount, "tab")} · {session.sourceDeviceName || "Unknown device"}
                </span>
              </span>
              {session.tags.length > 0 && <SessionTags tags={session.tags} limit={3} />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The Saved sessions list (docs/UI_UX_DESIGN.md 18n): search, Active/Archived, the workspace
 * filter and the sessions, all kept in the URL. Opening a session keeps the list as it was.
 */
export async function SessionsRail({ userId, request, selectedId }: SessionsRailProps) {
  const { query, archived } = request;
  const prisma = getPrisma();
  const filters = await listWorkspaceFilters(prisma, userId, { archived });
  const byId = new Map(filters.workspaces.map((workspace) => [workspace.id, workspace]));
  // Only the user's own workspaces filter; any other value shows everything.
  const workspace = parseWorkspaceFilter(request.workspace ?? undefined, new Set(byId.keys()));
  const name = workspace && workspace !== NO_WORKSPACE ? byId.get(workspace)?.name : null;
  const scope = workspace === NO_WORKSPACE ? "in no workspace" : name ? `in “${name}”` : null;
  const sessions = await listSessions(prisma, userId, { query, archived, workspace, pinnedFirst: true });
  const Heading = selectedId ? "h2" : "h1";

  return (
    <>
      {/* In the rail (>=1280px) the header stays put while the sessions scroll under it. */}
      <header className="space-y-3 border-b border-line bg-surface px-4 py-5 lg:px-6 xl:sticky xl:top-0 xl:z-10 xl:px-4 xl:py-4">
        <div className="flex items-baseline justify-between gap-3">
          <Heading className="text-2xl font-bold tracking-tight xl:text-xl">Saved sessions</Heading>
          {sessions.length > 0 && <span className="text-xs tabular-nums text-fg-muted">{plural(sessions.length, "session")}</span>}
        </div>
        <p className="text-xs text-fg-muted">{describe(query, scope)}</p>
        <SessionSearch query={query} archived={archived} workspace={workspace} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ViewTabs archived={archived} query={query} workspace={workspace} />
          {filters.workspaces.length > 0 && <WorkspaceFilter {...filters} value={workspace} archived={archived} query={query} />}
        </div>
      </header>
      {sessions.length > 0 && (
        <SessionRows
          sessions={sessions}
          selectedId={selectedId}
          linkFor={(id) => sessionsHref({ archived, query, workspace, id })}
          workspaces={workspace === null ? byId : undefined}
        />
      )}
      {sessions.length === SESSION_LIST_LIMIT && (
        <p className="px-4 py-3 text-xs text-fg-muted lg:px-6 xl:px-4">Showing the {SESSION_LIST_LIMIT} most recent. Search to narrow it down.</p>
      )}
      {sessions.length === 0 && (
        <div className="p-4">
          {query ? (
            <EmptyState icon={SearchX} title="No sessions match your search">
              Try a different name{scope ? ", or another workspace" : ""}. Search looks at session names for now.
            </EmptyState>
          ) : workspace !== null ? (
            <EmptyState icon={FolderOpen} title={`No ${archived ? "archived " : ""}sessions ${scope}`}>
              {workspace === NO_WORKSPACE ? "Every session here is in a workspace." : "Open a session and choose this workspace for it, here or in the SessionHub extension."}
            </EmptyState>
          ) : archived ? (
            <EmptyState icon={Archive} title="No archived sessions">
              Archive a session from its details to tidy your list without deleting it.
            </EmptyState>
          ) : (
            <EmptyState icon={Layers} title="No synced sessions yet">
              Save a session with the SessionHub extension and turn on sync there (Account, then Sync). Until you do, sessions stay in the
              browser where you saved them.
            </EmptyState>
          )}
        </div>
      )}
    </>
  );
}
