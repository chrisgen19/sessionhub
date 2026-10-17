import { useId, useState } from "react";
import { useWorkspaces } from "../../hooks/use-workspaces";
import { sendCommand } from "../../lib/message-client";
import { selectClass } from "./workspace-fields";

interface WorkspacePickerProps {
  sessionId: string;
  /** The session is in the connected account (only those can be in a workspace). */
  inAccount: boolean;
  workspaceId: string | null;
}

/** The session's workspace in the inspector; moving it uploads like any other edit. */
export function WorkspacePicker({ sessionId, inAccount, workspaceId }: WorkspacePickerProps) {
  const id = useId();
  const spaces = useWorkspaces();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!spaces?.connected || (spaces.workspaces.length === 0 && !spaces.syncEnabled)) return null;
  if (!inAccount) {
    return <p className="text-xs text-fg-muted">Only sessions in your account can be in a workspace. Upload this one first: Account, then Sync.</p>;
  }
  // Workspaces the account refused can't hold sessions; one assigned elsewhere may not have downloaded yet.
  const choices = spaces.workspaces.filter((workspace) => workspace.sync.state !== "error" || workspace.id === workspaceId);
  const unknown = workspaceId !== null && !choices.some((workspace) => workspace.id === workspaceId);

  const assign = async (value: string) => {
    setBusy(true);
    setError(null);
    const response = await sendCommand({ type: "session.assign", sessionId, workspaceId: value || null });
    setBusy(false);
    if (!response.ok) setError(response.error.message);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-xs font-semibold text-fg-muted">
          Workspace
        </label>
        <select id={id} value={workspaceId ?? ""} disabled={busy} onChange={(event) => void assign(event.target.value)} className={`${selectClass} max-w-64 min-w-0`}>
          <option value="">No workspace</option>
          {choices.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
          {unknown && (
            <option value={workspaceId} disabled>
              Not downloaded yet
            </option>
          )}
        </select>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          Not moved: {error}
        </p>
      )}
    </div>
  );
}
