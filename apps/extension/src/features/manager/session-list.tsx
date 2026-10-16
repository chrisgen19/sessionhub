import { Layers } from "lucide-react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { summarizeSession } from "@sessionhub/core/session-summary";
import type { SessionsState } from "../../hooks/use-sessions";
import { formatListDate, plural, sessionSourceLabel } from "../../lib/format";

interface SessionListProps {
  state: SessionsState;
  sessions: SavedSession[];
  selectedId: string | null;
  searching: boolean;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

export function SessionList({ state, sessions, selectedId, searching, onSelect, onRetry }: SessionListProps) {
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
  if (sessions.length === 0) {
    return (
      <div className="m-4 rounded-xl border border-dashed border-line px-4 py-10 text-center">
        <p className="text-[13px] font-semibold">{searching ? "No sessions match your search" : "No saved sessions yet"}</p>
        {!searching && (
          <p className="mt-1 text-xs text-fg-muted">Click the SessionHub toolbar icon and choose Save window, or import a SessionHub export.</p>
        )}
      </div>
    );
  }

  return (
    <ul aria-label="Saved sessions" className="divide-y divide-line">
      {sessions.map((session) => {
        const summary = summarizeSession(session);
        const selected = session.id === selectedId;
        return (
          <li key={session.id}>
            <button
              type="button"
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(session.id)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted ${
                selected ? "bg-brand-soft shadow-[inset_3px_0_0_var(--sh-brand)]" : ""
              }`}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-muted text-brand">
                <Layers aria-hidden="true" className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold" title={session.name}>
                  {session.name}
                </span>
                <span className="block truncate text-xs text-fg-muted">
                  {plural(summary.tabCount, "tab")} · {plural(summary.windowCount, "window")} · {sessionSourceLabel(session)} · Local only
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-fg-muted">{formatListDate(session.updatedAt)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
