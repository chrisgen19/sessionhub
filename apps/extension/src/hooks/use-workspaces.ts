import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { getDb } from "../lib/db";
import { readWorkspaces, type WorkspacesSnapshot } from "../lib/workspace-repository";

/** Live workspaces of the connected account (null while loading). Updates when the worker writes. */
export function useWorkspaces(): WorkspacesSnapshot | null {
  const [snapshot, setSnapshot] = useState<WorkspacesSnapshot | null>(null);
  useEffect(() => {
    const subscription = liveQuery(() => readWorkspaces(getDb())).subscribe({
      next: setSnapshot,
      error: () => setSnapshot({ connected: false, syncEnabled: false, workspaces: [] }),
    });
    return () => subscription.unsubscribe();
  }, []);
  return snapshot;
}
