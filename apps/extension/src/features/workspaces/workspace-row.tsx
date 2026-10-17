import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { TabGroupColor } from "@sessionhub/contracts/session";
import { ColorDot } from "../../components/color-dot";
import { buttonClass } from "../../components/modal";
import type { LocalWorkspaceRecord } from "../../lib/db";
import { plural } from "../../lib/format";
import { sendCommand } from "../../lib/message-client";
import { WorkspaceFields } from "./workspace-fields";

const iconButton = "grid size-8 shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-surface-muted";

/** What a workspace's delete does to its sessions, in plain words (user's decision: they move out). */
export const deleteConsequence = (sessionCount: number): string =>
  `${sessionCount > 0 ? `Its ${plural(sessionCount, "session")} ${sessionCount === 1 ? "moves" : "move"} to No workspace. ` : ""}No session is deleted and no tabs close, here or in your other browsers.`;

function EditForm({ workspace, onDone }: { workspace: LocalWorkspaceRecord; onDone: () => void }) {
  const [name, setName] = useState(workspace.name);
  const [color, setColor] = useState<TabGroupColor | null>(workspace.color);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const response = await sendCommand({ type: "workspace.update", workspaceId: workspace.id, name, color });
    setBusy(false);
    if (response.ok) onDone();
    else setError(response.error.message);
  };

  return (
    <form aria-label={`Edit ${workspace.name}`} onSubmit={(event) => void submit(event)} className="space-y-2">
      <WorkspaceFields name={name} color={color} onName={setName} onColor={setColor} autoFocus />
      {error && (
        <p role="alert" className="text-xs text-danger">
          Not saved: {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={buttonClass.primary}>
          Save
        </button>
        <button type="button" onClick={onDone} className={buttonClass.secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ConfirmDelete({ workspace, sessionCount, onDone }: { workspace: LocalWorkspaceRecord; sessionCount: number; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    const response = await sendCommand({ type: "workspace.delete", workspaceId: workspace.id });
    setBusy(false);
    if (!response.ok) setError(response.error.message);
  };

  return (
    <div role="group" aria-label={`Delete ${workspace.name}`} className="space-y-2 rounded-lg bg-danger-soft px-3 py-2.5">
      <p className="text-xs text-fg">
        <span className="font-semibold">Delete &ldquo;{workspace.name}&rdquo;?</span> {deleteConsequence(sessionCount)}
      </p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          Not deleted: {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" autoFocus onClick={onDone} disabled={busy} className={buttonClass.secondary}>
          Cancel
        </button>
        <button type="button" onClick={() => void confirm()} disabled={busy} className={buttonClass.danger}>
          Delete workspace
        </button>
      </div>
    </div>
  );
}

/** One workspace in the Workspaces dialog: its state, plus rename/recolor and delete in place. */
export function WorkspaceRow({ workspace, sessionCount }: { workspace: LocalWorkspaceRecord; sessionCount: number }) {
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const failed = workspace.sync.state === "error";

  if (mode === "edit") return <EditForm workspace={workspace} onDone={() => setMode("view")} />;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <ColorDot color={workspace.color} className="size-3" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold" title={workspace.name}>
            {workspace.name}
          </span>
          <span className="block text-xs text-fg-muted">
            {plural(sessionCount, "session")}
            {workspace.sync.state === "pending" && " · Waiting to sync"}
          </span>
        </span>
        <button type="button" aria-label={`Edit ${workspace.name}`} className={iconButton} onClick={() => setMode("edit")}>
          <Pencil aria-hidden="true" className="size-4" />
        </button>
        <button type="button" aria-label={`Delete ${workspace.name}`} className={iconButton} onClick={() => setMode("delete")}>
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      </div>
      {failed && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          Not added to your account: {workspace.sync.lastError ?? "it was refused."} Its sessions wait until you delete it.
        </p>
      )}
      {mode === "delete" && <ConfirmDelete workspace={workspace} sessionCount={sessionCount} onDone={() => setMode("view")} />}
    </div>
  );
}
