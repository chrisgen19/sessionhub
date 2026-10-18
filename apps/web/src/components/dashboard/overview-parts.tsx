import { Layers, MonitorSmartphone } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatRelative, formatRelativeInline, plural } from "@/lib/format";
import { sessionsHref } from "@/lib/workspace-filter";
import type { DeviceListItem, SessionListItem, WorkspaceChoice, WorkspaceFilters } from "@/server/queries/dashboard";
import { ColorDot } from "./color-dot";

/** A titled panel with an optional link to the full page. */
function Panel({ title, link, children }: { title: string; link?: { href: string; label: string }; children: ReactNode }) {
  const id = `${title.toLowerCase().replace(/\W+/g, "-")}-heading`;
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {link && (
          <Link href={link.href} className="text-xs font-semibold text-brand hover:underline">
            {link.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

const quiet = "px-4 py-6 text-center text-[13px] text-fg-muted";

/** The latest sessions; each opens beside the full list. */
export function RecentSessions({ sessions, workspaces }: { sessions: SessionListItem[]; workspaces: ReadonlyMap<string, WorkspaceChoice> }) {
  const now = new Date();
  return (
    <Panel title="Recently updated" link={sessions.length > 0 ? { href: "/app/sessions", label: "All sessions" } : undefined}>
      {sessions.length === 0 ? (
        <div className={quiet}>
          <Layers aria-hidden="true" className="mx-auto mb-2 size-5" />
          <p className="font-semibold text-fg">No synced sessions yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed">
            Save sessions with the SessionHub extension and turn on sync there (Account, then Sync). They show up here after their first sync.
          </p>
        </div>
      ) : (
        <ul aria-label="Recently updated sessions" className="divide-y divide-line">
          {sessions.map((session) => {
            const workspace = session.workspaceId ? workspaces.get(session.workspaceId) : undefined;
            return (
              <li key={session.id}>
                <Link href={sessionsHref({ archived: false, query: "", workspace: null, id: session.id })} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-muted">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold" title={session.name}>
                      {session.name}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
                      {workspace && (
                        <>
                          <ColorDot color={workspace.color} />
                          <span className="truncate">{workspace.name}</span>
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      <span className="shrink-0">{plural(session.tabCount, "tab")}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-fg-muted">{formatRelative(session.updatedAt, now)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** Connected browsers and when each last reached the server ("last seen", never "online": there is no heartbeat). */
export function ConnectedBrowsers({ devices }: { devices: DeviceListItem[] }) {
  const now = new Date();
  return (
    <Panel title="Browsers" link={{ href: "/app/devices", label: "Manage" }}>
      {devices.length === 0 ? (
        <p className={quiet}>None connected yet.</p>
      ) : (
        <ul aria-label="Connected browsers" className="divide-y divide-line">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center gap-3 px-4 py-2.5">
              <MonitorSmartphone aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{device.displayName}</span>
                <span className="block truncate text-xs text-fg-muted">
                  {device.lastSeenAt ? `Last seen ${formatRelativeInline(device.lastSeenAt, now)}` : "Not seen yet"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Workspaces with their active sessions, each linking to the filtered list. */
export function WorkspaceSummary({ filters }: { filters: WorkspaceFilters }) {
  return (
    <Panel title="Workspaces">
      {filters.workspaces.length === 0 ? (
        <p className={quiet}>No workspaces yet. Create them in the SessionHub extension&apos;s manager.</p>
      ) : (
        <ul aria-label="Workspaces" className="divide-y divide-line">
          {filters.workspaces.map((workspace) => (
            <li key={workspace.id}>
              <Link href={sessionsHref({ archived: false, query: "", workspace: workspace.id })} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-surface-muted">
                <ColorDot color={workspace.color} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{workspace.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-fg-muted">{plural(workspace.sessionCount, "session")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
