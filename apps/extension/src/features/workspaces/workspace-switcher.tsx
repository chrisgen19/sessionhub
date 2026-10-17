import { FolderCog } from "lucide-react";
import { useId, useState } from "react";
import type { LocalWorkspaceRecord } from "../../lib/db";
import { NO_WORKSPACE } from "../../hooks/use-manager-route";
import { selectClass } from "./workspace-fields";
import { WorkspacesDialog } from "./workspaces-dialog";

interface WorkspaceSwitcherProps {
  workspaces: LocalWorkspaceRecord[];
  /** A workspace id, NO_WORKSPACE, or null for all sessions. */
  value: string | null;
  sessionCounts: Record<string, number>;
  canCreate: boolean;
  onChange: (value: string | null) => void;
}

/** Filters the saved-session list by workspace; switching never opens or closes tabs. */
export function WorkspaceSwitcher({ workspaces, value, sessionCounts, canCreate, onChange }: WorkspaceSwitcherProps) {
  const id = useId();
  const [managing, setManaging] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs font-semibold text-fg-muted">
        Workspace
      </label>
      <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} className={`${selectClass} max-w-48 min-w-0 font-semibold`}>
        <option value="">All sessions</option>
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name} ({sessionCounts[workspace.id] ?? 0})
          </option>
        ))}
        <option value={NO_WORKSPACE}>No workspace ({sessionCounts[NO_WORKSPACE] ?? 0})</option>
      </select>
      <button
        type="button"
        aria-label="Manage workspaces"
        title="Manage workspaces"
        onClick={() => setManaging(true)}
        className="grid size-9 shrink-0 place-items-center rounded-lg border border-line text-fg-muted hover:bg-surface-muted"
      >
        <FolderCog aria-hidden="true" className="size-4" />
      </button>
      {managing && (
        <WorkspacesDialog
          workspaces={workspaces}
          sessionCounts={sessionCounts}
          canCreate={canCreate}
          onClose={() => setManaging(false)}
          onCreated={(created) => onChange(created)}
        />
      )}
    </div>
  );
}
