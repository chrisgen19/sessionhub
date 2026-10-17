import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { TabGroupColor } from "@sessionhub/contracts/session";
import { buttonClass, Modal } from "../../components/modal";
import type { LocalWorkspaceRecord } from "../../lib/db";
import { sendCommand } from "../../lib/message-client";
import { WorkspaceFields } from "./workspace-fields";
import { WorkspaceRow } from "./workspace-row";

function CreateForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<TabGroupColor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const response = await sendCommand({ type: "workspace.create", name, color });
    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    setName("");
    setColor(null);
    setError(null);
    onCreated(response.data.workspaceId);
  };

  return (
    <form aria-label="New workspace" onSubmit={(event) => void submit(event)} className="space-y-2">
      <WorkspaceFields name={name} color={color} onName={setName} onColor={setColor} />
      {error && (
        <p role="alert" className="text-xs text-danger">
          Not created: {error}
        </p>
      )}
      <button type="submit" disabled={busy || name.trim().length === 0} className={buttonClass.secondary}>
        <Plus aria-hidden="true" className="size-4" />
        Add workspace
      </button>
    </form>
  );
}

interface WorkspacesDialogProps {
  workspaces: LocalWorkspaceRecord[];
  sessionCounts: Record<string, number>;
  /** Sync is on: new workspaces can go to the account. */
  canCreate: boolean;
  onClose: () => void;
  /** Shows the new workspace's sessions (none yet) once it is created. */
  onCreated: (id: string) => void;
}

/** Create, rename, recolor and delete the account's workspaces (docs/UI_UX_DESIGN.md 18g). */
export function WorkspacesDialog({ workspaces, sessionCounts, canCreate, onClose, onCreated }: WorkspacesDialogProps) {
  return (
    <Modal title="Workspaces" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-[13px] text-fg-muted">
          Workspaces group the sessions in your account, in every browser connected to it. Choosing one only filters the list: no tabs open or
          close.
        </p>
        {canCreate ? <CreateForm onCreated={onCreated} /> : <p className="text-xs text-fg-muted">Turn on sync in Account to add workspaces.</p>}
        {workspaces.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-fg-muted">No workspaces yet.</p>
        ) : (
          <ul aria-label="Your workspaces" className="divide-y divide-line rounded-lg border border-line">
            {workspaces.map((workspace) => (
              <li key={workspace.id} className="px-3 py-2">
                <WorkspaceRow workspace={workspace} sessionCount={sessionCounts[workspace.id] ?? 0} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
