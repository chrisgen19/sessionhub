import { Layers, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/dashboard/page-parts";
import { SessionList } from "@/components/dashboard/session-list";
import { getPrisma } from "@sessionhub/database/client";
import { plural } from "@/lib/format";
import { listSessions, SESSION_LIST_LIMIT } from "@/server/queries/dashboard";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Saved sessions · SessionHub" };

export default async function SessionsPage(props: PageProps<"/app/sessions">) {
  const { q } = await props.searchParams;
  const query = typeof q === "string" ? q.trim().slice(0, 200) : "";
  const { user } = await requireSession(query ? `/app/sessions?q=${encodeURIComponent(query)}` : "/app/sessions");
  const sessions = await listSessions(getPrisma(), user.id, { query });

  return (
    <>
      <PageHeader
        title="Saved sessions"
        description={query ? `Results for “${query}”` : "Sessions synced to your account from your browsers."}
        aside={sessions.length > 0 ? <span className="text-xs tabular-nums text-fg-muted">{plural(sessions.length, "session")}</span> : null}
      />
      {sessions.length > 0 && <SessionList sessions={sessions} />}
      {sessions.length === SESSION_LIST_LIMIT && (
        <p className="mt-3 text-xs text-fg-muted">Showing the {SESSION_LIST_LIMIT} most recent. Search to narrow it down.</p>
      )}
      {sessions.length === 0 && query && (
        <EmptyState icon={SearchX} title="No sessions match your search">
          Try a different name. Search looks at session names for now.
        </EmptyState>
      )}
      {sessions.length === 0 && !query && (
        <EmptyState icon={Layers} title="No synced sessions yet">
          Save your first session with the SessionHub extension. Sessions appear here once cloud sync is available and you turn it
          on. Until then they stay on the computer where you saved them.
        </EmptyState>
      )}
    </>
  );
}
