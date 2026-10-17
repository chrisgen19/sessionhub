import type { SavedSession } from "@sessionhub/contracts/session";
import type { RestoreDestination } from "@sessionhub/core/restore-plan";
import type { SessionsState } from "../../hooks/use-sessions";
import { SessionRow } from "./session-row";

interface RecentSessionsProps {
  state: SessionsState;
  sessions: SavedSession[];
  searching: boolean;
  destination: RestoreDestination;
  onDestination: (destination: RestoreDestination) => void;
  skipOpen: boolean;
  lazy: boolean;
  onShow: (sessionId: string) => void;
  onDetails: (sessionId: string) => void;
  onRetry: () => void;
}

export function RecentSessions({ state, sessions, searching, destination, onDestination, skipOpen, lazy, onShow, onDetails, onRetry }: RecentSessionsProps) {
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
        {searching ? "No sessions match your search." : "No saved sessions yet. Save tabs from the Save tab to get started."}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {sessions.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          syncLabel={state.syncLabels[session.id] ?? "local"}
          destination={destination}
          onDestination={onDestination}
          skipOpen={skipOpen}
          lazy={lazy}
          onShow={() => onShow(session.id)}
          onDetails={() => onDetails(session.id)}
        />
      ))}
    </ul>
  );
}
