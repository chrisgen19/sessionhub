import { Archive, FolderOpen, Layers, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/dashboard/page-parts";
import { SessionList } from "@/components/dashboard/session-list";
import { WorkspaceFilter } from "@/components/dashboard/workspace-filter";
import { getPrisma } from "@sessionhub/database/client";
import { plural } from "@/lib/format";
import { NO_WORKSPACE, parseWorkspaceFilter, sessionsHref } from "@/lib/workspace-filter";
import { listSessions, listWorkspaceFilters, SESSION_LIST_LIMIT } from "@/server/queries/dashboard";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Saved sessions · SessionHub" };

function ViewTabs({ archived, query, workspace }: { archived: boolean; query: string; workspace: string | null }) {
  const tab = (view: "active" | "archived", label: string, current: boolean) => (
    <Link
      href={sessionsHref({ archived: view === "archived", query, workspace })}
      aria-current={current ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold ${current ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Session views" className="inline-flex rounded-lg bg-surface-muted p-1">
      {tab("active", "Active", !archived)}
      {tab("archived", "Archived", archived)}
    </nav>
  );
}

const describe = (query: string, scope: string | null) => {
  if (query) return `Results for “${query}”${scope ? ` ${scope}` : ""}`;
  return scope ? `Sessions ${scope}.` : "Sessions synced to your account from your browsers.";
};

export default async function SessionsPage(props: PageProps<"/app/sessions">) {
  const { q, view, workspace: requested } = await props.searchParams;
  const query = typeof q === "string" ? q.trim().slice(0, 200) : "";
  const archived = view === "archived";
  const { user } = await requireSession(sessionsHref({ archived, query, workspace: typeof requested === "string" ? requested : null }));
  const prisma = getPrisma();
  const filters = await listWorkspaceFilters(prisma, user.id, { archived });
  const byId = new Map(filters.workspaces.map((workspace) => [workspace.id, workspace]));
  // Only the user's own workspaces filter; any other value shows everything.
  const workspace = parseWorkspaceFilter(requested, new Set(byId.keys()));
  const name = workspace && workspace !== NO_WORKSPACE ? byId.get(workspace)?.name : null;
  const scope = workspace === NO_WORKSPACE ? "in no workspace" : name ? `in “${name}”` : null;
  const sessions = await listSessions(prisma, user.id, { query, archived, workspace });
  const filtering = workspace !== null || query.length > 0;

  return (
    <>
      <PageHeader
        title="Saved sessions"
        description={describe(query, scope)}
        aside={sessions.length > 0 ? <span className="text-xs tabular-nums text-fg-muted">{plural(sessions.length, "session")}</span> : null}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ViewTabs archived={archived} query={query} workspace={workspace} />
        {filters.workspaces.length > 0 && <WorkspaceFilter {...filters} value={workspace} archived={archived} query={query} />}
      </div>
      {sessions.length > 0 && <SessionList sessions={sessions} workspaces={workspace === null ? byId : undefined} />}
      {sessions.length === SESSION_LIST_LIMIT && (
        <p className="mt-3 text-xs text-fg-muted">Showing the {SESSION_LIST_LIMIT} most recent. Search to narrow it down.</p>
      )}
      {sessions.length === 0 && query && (
        <EmptyState icon={SearchX} title="No sessions match your search">
          Try a different name{scope ? ", or another workspace" : ""}. Search looks at session names for now.
        </EmptyState>
      )}
      {sessions.length === 0 && !query && workspace !== null && (
        <EmptyState icon={FolderOpen} title={`No ${archived ? "archived " : ""}sessions ${scope}`}>
          {workspace === NO_WORKSPACE
            ? "Every session here is in a workspace."
            : "Open a session and choose this workspace for it, here or in the SessionHub extension."}
        </EmptyState>
      )}
      {sessions.length === 0 && !filtering && archived && (
        <EmptyState icon={Archive} title="No archived sessions">
          Archive a session from its page to tidy your list without deleting it.
        </EmptyState>
      )}
      {sessions.length === 0 && !filtering && !archived && (
        <EmptyState icon={Layers} title="No synced sessions yet">
          Save a session with the SessionHub extension and turn on sync there (Account, then Sync). Until you do, sessions stay in the
          browser where you saved them.
        </EmptyState>
      )}
    </>
  );
}
