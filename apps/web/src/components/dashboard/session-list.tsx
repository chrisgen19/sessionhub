import { Layers } from "lucide-react";
import Link from "next/link";
import { formatRelative, plural } from "@/lib/format";
import type { SessionListItem, WorkspaceChoice } from "@/server/queries/dashboard";
import { ColorDot } from "./color-dot";

interface SessionListProps {
  sessions: SessionListItem[];
  /** Names each row's workspace; leave out where the list is already one workspace. */
  workspaces?: ReadonlyMap<string, WorkspaceChoice>;
  now?: Date;
}

/** Compact table on desktop, stacked rows on mobile (docs/UI_UX_DESIGN.md section 8). */
export function SessionList({ sessions, workspaces, now = new Date() }: SessionListProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="hidden grid-cols-[minmax(0,1fr)_160px_80px_100px] gap-3 border-b border-line px-4 py-2.5 text-[10px] font-semibold tracking-wide text-fg-muted uppercase md:grid">
        <span>Session</span>
        <span>Source</span>
        <span className="text-right">Tabs</span>
        <span className="text-right">Updated</span>
      </div>
      <ul aria-label="Saved sessions" className="divide-y divide-line">
        {sessions.map((session) => {
          const workspace = session.workspaceId ? workspaces?.get(session.workspaceId) : undefined;
          return (
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
                {workspace && (
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-fg">
                    <ColorDot color={workspace.color} />
                    <span className="truncate">{workspace.name}</span>
                  </span>
                )}
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
          );
        })}
      </ul>
    </div>
  );
}
