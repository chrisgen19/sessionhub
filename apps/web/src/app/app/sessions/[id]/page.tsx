import { ChevronRight, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SessionActions } from "@/components/sessions/session-actions";
import { WindowTree } from "@/components/sessions/window-tree";
import { getPrisma } from "@sessionhub/database/client";
import { formatRelative, plural } from "@/lib/format";
import { getSessionDetail } from "@/server/sessions/queries";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Session · SessionHub" };

export default async function SessionDetailPage(props: PageProps<"/app/sessions/[id]">) {
  const { id } = await props.params;
  const { user } = await requireSession(`/app/sessions/${encodeURIComponent(id)}`);
  // Malformed, missing, deleted and other users' ids all look the same.
  const detail = z.uuid().safeParse(id).success ? await getSessionDetail(getPrisma(), user.id, id) : null;
  if (!detail) notFound();

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-xs text-fg-muted">
        <Link href={detail.isArchived ? "/app/sessions?view=archived" : "/app/sessions"} className="hover:text-fg hover:underline">
          Saved sessions
        </Link>
        <ChevronRight aria-hidden="true" className="size-3.5" />
        <span aria-current="page" className="truncate">{detail.name}</span>
      </nav>
      <header className="mb-5">
        <h1 className="flex flex-wrap items-center gap-2 text-[26px] font-bold tracking-tight break-words">
          {detail.name}
          {detail.isPinned && <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand">Pinned</span>}
          {detail.isArchived && <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-fg-muted">Archived</span>}
        </h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          From {detail.sourceDeviceName || "an unknown device"} · {plural(detail.windowCount, "window")} · {plural(detail.tabCount, "tab")} · updated{" "}
          {formatRelative(new Date(detail.updatedAt)).toLowerCase()} · version {detail.version}
        </p>
      </header>
      <SessionActions detail={detail} />
      <p className="my-5 flex items-start gap-2 rounded-xl border border-line bg-surface p-3 text-[13px] text-fg-muted">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          To reopen these tabs as browser windows, export the JSON and import it in the SessionHub extension&apos;s manager. The
          website can&apos;t open or change windows in your browser.
        </span>
      </p>
      <WindowTree windows={detail.windows} />
    </>
  );
}
