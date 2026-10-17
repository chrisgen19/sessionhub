import type { SavedSession } from "@sessionhub/contracts/session";
import { summarizeSession } from "@sessionhub/core/session-summary";
import type { SessionsState } from "../../hooks/use-sessions";
import { formatListDate, plural, sessionSourceLabel } from "../../lib/format";
import { SESSION_SYNC_TEXT, type SessionSyncLabel } from "../../lib/sync-status";
import { SessionFavicons } from "./session-favicons";

interface SessionListProps {
  state: SessionsState;
  sessions: SavedSession[];
  selectedId: string | null;
  searching: boolean;
  /** Name of the workspace the list is filtered to ("No workspace" included), for the empty state. */
  workspace?: string | null;
  /** A session's workspace name to show in its row (null: none, or the list is already filtered). */
  workspaceName?: (id: string) => string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

const PROBLEM = new Set<SessionSyncLabel>(["conflict", "error"]);

function EmptyList({ searching, workspace }: { searching: boolean; workspace: string | null }) {
  const title = searching ? "No sessions match your search" : workspace ? `No sessions in ${workspace}` : "No saved sessions yet";
  const hint = workspace
    ? "Open a session and choose its workspace in the details."
    : "Choose tabs to save in Open tabs or from the SessionHub toolbar icon, or import a SessionHub export.";
  return (
    <div className="m-4 rounded-xl border border-dashed border-line px-4 py-10 text-center">
      <p className="text-[13px] font-semibold">{title}</p>
      {!searching && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

export function SessionList({ state, sessions, selectedId, searching, workspace = null, workspaceName = () => null, onSelect, onRetry }: SessionListProps) {
  const label = (id: string): SessionSyncLabel => (state.status === "ready" ? (state.syncLabels[id] ?? "local") : "local");
  if (state.status === "loading") {
    return (
      <div aria-busy="true" aria-label="Loading sessions" className="space-y-2 p-4">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="h-14 animate-pulse rounded-lg bg-surface-muted" />
        ))}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="m-4 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
        Couldn't load saved sessions: {state.message}{" "}
        <button type="button" className="font-semibold underline" onClick={onRetry}>
          Retry
        </button>
      </p>
    );
  }
  if (sessions.length === 0) return <EmptyList searching={searching} workspace={workspace} />;

  return (
    <ul aria-label="Saved sessions" className="divide-y divide-line">
      {sessions.map((session) => {
        const summary = summarizeSession(session);
        const selected = session.id === selectedId;
        const inWorkspace = workspaceName(session.id);
        return (
          <li key={session.id}>
            <button
              type="button"
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(session.id)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted lg:px-6 xl:px-4 ${
                selected ? "bg-brand-soft shadow-[inset_3px_0_0_var(--sh-brand)]" : ""
              }`}
            >
              <SessionFavicons session={session} />
              {/* The date and sync status don't shrink, so the narrow list rail never truncates them away. */}
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={session.name}>
                    {session.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-fg-muted">{formatListDate(session.updatedAt)}</span>
                </span>
                <span className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                    {inWorkspace && <span className="font-semibold text-fg">{inWorkspace} · </span>}
                    {plural(summary.tabCount, "tab")} · {plural(summary.windowCount, "window")} · {sessionSourceLabel(session)}
                  </span>
                  <span className={`shrink-0 text-[11px] font-semibold ${PROBLEM.has(label(session.id)) ? "text-warning" : "text-fg-muted"}`}>{SESSION_SYNC_TEXT[label(session.id)]}</span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
