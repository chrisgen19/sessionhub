import { liveQuery } from "dexie";
import { useCallback, useEffect, useState } from "react";
import { getDb, type RecoverySnapshotRecord, type RecoveryStateRecord } from "../lib/db";
import { getRecoveryState, listSnapshots } from "../lib/recovery-repository";

export type RecoveryData =
  | { status: "loading" }
  | { status: "ready"; snapshots: RecoverySnapshotRecord[]; state: RecoveryStateRecord }
  | { status: "error"; message: string };

/** Live checkpoints (newest first) and recovery state, updated by background writes. */
export function useRecovery(): { data: RecoveryData; retry: () => void } {
  const [data, setData] = useState<RecoveryData>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const db = getDb();
    const subscription = liveQuery(async () => ({ snapshots: await listSnapshots(db), state: await getRecoveryState(db) })).subscribe({
      next: (value) => setData({ status: "ready", ...value }),
      error: (error: unknown) =>
        setData({ status: "error", message: error instanceof Error ? error.message : "Checkpoint storage unavailable" }),
    });
    return () => subscription.unsubscribe();
  }, [attempt]);

  const retry = useCallback(() => {
    setData({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  return { data, retry };
}
