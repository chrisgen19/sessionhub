import { ChevronRight, Layers } from "lucide-react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { summarizeSession } from "@sessionhub/core/session-summary";
import type { SessionsState } from "../../hooks/use-sessions";
import { formatListDate, plural, sessionSourceLabel } from "../../lib/format";

interface RecentSessionsProps {
  state: SessionsState;
  sessions: SavedSession[];
  searching: boolean;
  onOpen: (sessionId: string) => void;
  onRetry: () => void;
}

export function RecentSessions({ state, sessions, searching, onOpen, onRetry }: RecentSessionsProps) {
  if (state.status === "loading") {
    return (
      <div aria-busy="true" aria-label="Loading sessions" className="space-y-2">
        {[0, 1, 2].map((key) => (
          <div key={key} className="h-11 animate-pulse rounded-lg bg-surface-muted" />
        ))}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
        Couldn't load saved sessions. Your data is still stored locally.{" "}
        <button type="button" className="font-semibold underline" onClick={onRetry}>
          Retry
        </button>
      </p>
    );
  }
  if (sessions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-fg-muted">
        {searching ? "No sessions match your search." : "No saved sessions yet. Save this window to get started."}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {sessions.map((session) => {
        const summary = summarizeSession(session);
        return (
          <li key={session.id}>
            <button
              type="button"
              onClick={() => onOpen(session.id)}
              className="flex w-full items-center gap-3 rounded-md px-1 py-2.5 text-left hover:bg-surface-muted"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                <Layers aria-hidden="true" className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold" title={session.name}>
                  {session.name}
                </span>
                <span className="block text-[11px] text-fg-muted">
                  {formatListDate(session.updatedAt)} · {sessionSourceLabel(session)}
                </span>
              </span>
              <span className="text-[11px] tabular-nums text-fg-muted">{plural(summary.tabCount, "tab")}</span>
              <ChevronRight aria-hidden="true" className="size-4 text-fg-muted" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
