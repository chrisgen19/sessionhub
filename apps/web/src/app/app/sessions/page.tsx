import { Archive, Layers, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/dashboard/page-parts";
import { SessionList } from "@/components/dashboard/session-list";
import { getPrisma } from "@sessionhub/database/client";
import { plural } from "@/lib/format";
import { listSessions, SESSION_LIST_LIMIT } from "@/server/queries/dashboard";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Saved sessions · SessionHub" };

function ViewTabs({ archived, query }: { archived: boolean; query: string }) {
  const href = (view: "active" | "archived") => {
    const params = new URLSearchParams({ ...(view === "archived" ? { view } : {}), ...(query ? { q: query } : {}) });
    return `/app/sessions${params.size ? `?${params}` : ""}`;
  };
  const tab = (view: "active" | "archived", label: string, current: boolean) => (
    <Link
      href={href(view)}
      aria-current={current ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold ${current ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Session views" className="mb-4 inline-flex rounded-lg bg-surface-muted p-1">
      {tab("active", "Active", !archived)}
      {tab("archived", "Archived", archived)}
    </nav>
  );
}

export default async function SessionsPage(props: PageProps<"/app/sessions">) {
  const { q, view } = await props.searchParams;
  const query = typeof q === "string" ? q.trim().slice(0, 200) : "";
  const archived = view === "archived";
  const { user } = await requireSession(query ? `/app/sessions?q=${encodeURIComponent(query)}` : "/app/sessions");
  const sessions = await listSessions(getPrisma(), user.id, { query, archived });

  return (
    <>
      <PageHeader
        title="Saved sessions"
        description={query ? `Results for “${query}”` : "Sessions synced to your account from your browsers."}
        aside={sessions.length > 0 ? <span className="text-xs tabular-nums text-fg-muted">{plural(sessions.length, "session")}</span> : null}
      />
      <ViewTabs archived={archived} query={query} />
      {sessions.length > 0 && <SessionList sessions={sessions} />}
      {sessions.length === SESSION_LIST_LIMIT && (
        <p className="mt-3 text-xs text-fg-muted">Showing the {SESSION_LIST_LIMIT} most recent. Search to narrow it down.</p>
      )}
      {sessions.length === 0 && query && (
        <EmptyState icon={SearchX} title="No sessions match your search">
          Try a different name. Search looks at session names for now.
        </EmptyState>
      )}
      {sessions.length === 0 && !query && archived && (
        <EmptyState icon={Archive} title="No archived sessions">
          Archive a session from its page to tidy your list without deleting it.
        </EmptyState>
      )}
      {sessions.length === 0 && !query && !archived && (
        <EmptyState icon={Layers} title="No synced sessions yet">
          Save your first session with the SessionHub extension. Sessions appear here once cloud sync is available and you turn it
          on. Until then they stay on the computer where you saved them.
        </EmptyState>
      )}
    </>
  );
}
