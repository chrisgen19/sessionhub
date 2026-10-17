"use client";

import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import { useId, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { WorkspaceChoice } from "@/server/queries/dashboard";
import { NoticeLine } from "./notice-line";
import { useSessionMutation } from "./use-session-mutation";

/**
 * Moves the session between workspaces with the version the page loaded: a change made elsewhere
 * meanwhile is a conflict, never overwritten. Workspaces are created in the extension for now.
 */
export function WorkspaceSelect({ detail, workspaces }: { detail: ApiSessionDetail; workspaces: WorkspaceChoice[] }) {
  const id = useId();
  const { pending, notice, run, loadLatest } = useSessionMutation();
  const [selected, setSelected] = useState(detail.workspaceId ?? "");
  // After a refresh brings a new version, show the server's workspace again; the notice stays.
  const [shownVersion, setShownVersion] = useState(detail.version);
  if (shownVersion !== detail.version) {
    setShownVersion(detail.version);
    setSelected(detail.workspaceId ?? "");
  }

  if (workspaces.length === 0) {
    return <p className="text-[13px] text-fg-muted">No workspaces yet. Create them in the SessionHub extension&apos;s manager (Workspaces), then choose one here.</p>;
  }

  const change = async (value: string) => {
    // Choosing the workspace it is already in changes nothing, so nothing is sent.
    if (value === (detail.workspaceId ?? "")) return setSelected(value);
    setSelected(value);
    const name = workspaces.find((workspace) => workspace.id === value)?.name;
    const ok = await run(
      () => apiFetch<ApiSessionDetail>(`/api/v1/sessions/${detail.id}`, "PATCH", { expectedVersion: detail.version, workspaceId: value || null }),
      () => (name ? `Moved to “${name}”.` : "Moved out of its workspace."),
    );
    if (!ok) setSelected(detail.workspaceId ?? "");
  };

  return (
    <section aria-label="Workspace" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-xs font-semibold text-fg-muted">
          Workspace
        </label>
        <select
          id={id}
          value={selected}
          disabled={pending}
          onChange={(event) => void change(event.target.value)}
          className="h-9 max-w-72 min-w-0 rounded-lg border border-line bg-surface px-2 text-[13px] text-fg disabled:opacity-60"
        >
          <option value="">No workspace</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      </div>
      <NoticeLine notice={notice} onLoadLatest={loadLatest} />
    </section>
  );
}
