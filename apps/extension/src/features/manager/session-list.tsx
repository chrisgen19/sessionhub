import type { SavedSession } from "@sessionhub/contracts/session";
import type { SessionsState } from "../../hooks/use-sessions";
import type { SessionSyncLabel } from "../../lib/sync-status";
import { SessionRow } from "./session-row";

interface SessionListProps {
  state: SessionsState;
  sessions: SavedSession[];
  selectedId: string | null;
  searching: boolean;
  /** Name of the workspace the list is filtered to ("No workspace" included), for the empty state. */
  workspace?: string | null;
  /** A session's workspace name to show in its row (null: none, or the list is already filtered). */
  workspaceName?: (id: string) => string | null;
  /** Ticked for bulk actions. */
  checked: ReadonlySet<string>;
  onCheck: (id: string, range: boolean) => void;
  /** Archived view: its own empty state. */
  archived?: boolean;
  /** A tag filter is on: its own empty state. */
  tag?: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

function EmptyList({ searching, workspace, archived, tag }: { searching: boolean; workspace: string | null; archived: boolean; tag: string | null }) {
  const title = searching
    ? "No sessions match your search"
    : tag
      ? `No sessions tagged ${tag}`
      : archived
        ? "No archived sessions"
        : workspace
          ? `No sessions in ${workspace}`
          : "No saved sessions yet";
  const hint = archived
    ? "Archive sessions you want to keep but not see every day. They stay here, ready to open."
    : workspace
      ? "Open a session and choose its workspace in the details."
      : "Choose tabs to save in Open tabs or from the SessionHub toolbar icon, or import a SessionHub export.";
  return (
    <div className="m-4 rounded-xl border border-dashed border-line px-4 py-10 text-center">
      <p className="text-[13px] font-semibold">{title}</p>
      {!searching && !tag && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

export function SessionList(props: SessionListProps) {
  const { state, sessions, selectedId, searching, workspace = null, workspaceName = () => null, checked, onCheck, archived = false, tag = null, onSelect, onRetry } = props;
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
  if (sessions.length === 0) return <EmptyList searching={searching} workspace={workspace} archived={archived} tag={tag} />;

  return (
    <ul aria-label="Saved sessions" className="divide-y divide-line">
      {sessions.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          syncLabel={label(session.id)}
          open={session.id === selectedId}
          checked={checked.has(session.id)}
          workspaceName={workspaceName(session.id)}
          onOpen={() => onSelect(session.id)}
          onCheck={(range) => onCheck(session.id, range)}
        />
      ))}
    </ul>
  );
}
