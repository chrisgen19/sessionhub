import { Layers } from "lucide-react";
import Link from "next/link";
import { formatRelative, plural } from "@/lib/format";
import type { SessionListItem } from "@/server/queries/dashboard";

/** Compact table on desktop, stacked rows on mobile (docs/UI_UX_DESIGN.md section 8). */
export function SessionList({ sessions, now = new Date() }: { sessions: SessionListItem[]; now?: Date }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="hidden grid-cols-[minmax(0,1fr)_160px_80px_100px] gap-3 border-b border-line px-4 py-2.5 text-[10px] font-semibold tracking-wide text-fg-muted uppercase md:grid">
        <span>Session</span>
        <span>Source</span>
        <span className="text-right">Tabs</span>
        <span className="text-right">Updated</span>
      </div>
      <ul aria-label="Saved sessions" className="divide-y divide-line">
        {sessions.map((session) => (
          <li key={session.id}>
            <Link
              href={`/app/sessions/${session.id}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-surface-muted md:grid-cols-[minmax(0,1fr)_160px_80px_100px]"
            >
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                <Layers aria-hidden="true" className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold" title={session.name}>
                  {session.name}
                </span>
                <span className="block truncate text-xs text-fg-muted md:hidden">
                  {session.sourceDeviceName || "Unknown device"} · {formatRelative(session.updatedAt, now)}
                </span>
              </span>
            </div>
            <span className="hidden truncate text-xs text-fg-muted md:block">{session.sourceDeviceName || "Unknown device"}</span>
            <span className="text-right text-xs tabular-nums text-fg-muted">{plural(session.tabCount, "tab")}</span>
            <span className="hidden text-right text-xs tabular-nums text-fg-muted md:block">{formatRelative(session.updatedAt, now)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
