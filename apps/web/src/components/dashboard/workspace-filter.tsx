"use client";

import { useRouter } from "next/navigation";
import { useId } from "react";
import { NO_WORKSPACE, sessionsHref } from "@/lib/workspace-filter";
import type { WorkspaceFilters } from "@/server/queries/dashboard";

interface WorkspaceFilterProps extends WorkspaceFilters {
  /** A workspace id, NO_WORKSPACE, or null for all sessions. */
  value: string | null;
  archived: boolean;
  query: string;
}

/** Filters the sessions list by workspace through the URL, keeping the view and search. */
export function WorkspaceFilter({ workspaces, unassigned, value, archived, query }: WorkspaceFilterProps) {
  const router = useRouter();
  const id = useId();
  return (
    <div className="flex min-w-0 items-center">
      {/* "Filter by", not "Workspace": a session's own workspace picker can be open beside the list. */}
      <label htmlFor={id} className="sr-only">
        Filter by workspace
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => router.push(sessionsHref({ archived, query, workspace: event.target.value || null }))}
        className="h-8 max-w-48 min-w-0 rounded-lg border border-line bg-surface px-2 text-xs font-semibold text-fg"
      >
        <option value="">All sessions</option>
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name} ({workspace.sessionCount})
          </option>
        ))}
        <option value={NO_WORKSPACE}>No workspace ({unassigned})</option>
      </select>
    </div>
  );
}
