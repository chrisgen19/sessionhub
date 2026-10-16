import { RECOVERY_RETENTION, selectSnapshotsToEvict, type RetentionPolicy, type SnapshotMeta } from "@sessionhub/core/recovery";
import { savedSessionSchema } from "@sessionhub/contracts/session";
import type { RecoverySnapshotRecord, RecoveryStateRecord, SessionHubDb } from "./db";

const emptyState = (): RecoveryStateRecord => ({
  key: "state",
  dirty: false,
  lastChangeAt: null,
  lastSnapshotAt: null,
  lastFingerprint: null,
  lastError: null,
});

export const getRecoveryState = async (db: SessionHubDb): Promise<RecoveryStateRecord> =>
  (await db.recoveryState.get("state")) ?? emptyState();

/** Records a browser change. Returns true when this flipped the state from clean to dirty. */
export const markRecoveryDirty = (db: SessionHubDb, now: Date): Promise<boolean> =>
  db.transaction("rw", db.recoveryState, async () => {
    const state = await getRecoveryState(db);
    await db.recoveryState.put({ ...state, dirty: true, lastChangeAt: now.toISOString() });
    return !state.dirty;
  });

export const recordRecoveryError = (db: SessionHubDb, message: string): Promise<void> =>
  db.transaction("rw", db.recoveryState, async () => {
    await db.recoveryState.put({ ...(await getRecoveryState(db)), lastError: message });
  });

/** Snapshot metadata read from index keys only, without loading snapshot bodies. */
const snapshotMetas = async (db: SessionHubDb): Promise<SnapshotMeta[]> => {
  const metas: SnapshotMeta[] = [];
  await db.recoverySnapshots.orderBy("[capturedAt+tabCount]").eachKey((key, cursor) => {
    const [capturedAt, tabCount] = key as [string, number];
    metas.push({ id: String(cursor.primaryKey), capturedAt, tabCount });
  });
  return metas;
};

export type CheckpointOutcome = "created" | "unchanged" | "empty";

export interface CommitCheckpointInput {
  /** null when there was nothing worth keeping (no tabs). */
  snapshot: RecoverySnapshotRecord | null;
  fingerprint: string;
  startedAt: Date;
  policy?: RetentionPolicy;
}

/**
 * Inserts a checkpoint and applies retention in ONE transaction: if the insert fails,
 * nothing is evicted, so an incomplete new snapshot can never cost the last good one.
 * The dirty flag is cleared only if no browser change arrived after capture started.
 */
export const commitCheckpoint = (
  db: SessionHubDb,
  input: CommitCheckpointInput,
): Promise<{ outcome: CheckpointOutcome; stillDirty: boolean }> =>
  db.transaction("rw", db.recoverySnapshots, db.recoveryState, async () => {
    const state = await getRecoveryState(db);
    const stillDirty = state.lastChangeAt !== null && state.lastChangeAt > input.startedAt.toISOString();
    const settled: RecoveryStateRecord = { ...state, dirty: stillDirty, lastError: null };

    if (!input.snapshot) {
      await db.recoveryState.put({ ...settled, lastFingerprint: input.fingerprint });
      return { outcome: "empty", stillDirty };
    }
    // Compared inside the transaction so two overlapping checkpoint runs can't both insert.
    if (state.lastFingerprint === input.fingerprint) {
      await db.recoveryState.put(settled);
      return { outcome: "unchanged", stillDirty };
    }
    savedSessionSchema.parse(input.snapshot.session);
    await db.recoverySnapshots.add(input.snapshot);
    const evict = selectSnapshotsToEvict(await snapshotMetas(db), new Date(input.snapshot.capturedAt), input.policy ?? RECOVERY_RETENTION);
    await db.recoverySnapshots.bulkDelete(evict);
    await db.recoveryState.put({ ...settled, lastFingerprint: input.fingerprint, lastSnapshotAt: input.snapshot.capturedAt });
    return { outcome: "created", stillDirty };
  });

/** Newest first. Bounded by retention (about 50 records). */
export const listSnapshots = (db: SessionHubDb): Promise<RecoverySnapshotRecord[]> =>
  db.recoverySnapshots.orderBy("capturedAt").reverse().toArray();

export const getSnapshot = (db: SessionHubDb, id: string): Promise<RecoverySnapshotRecord | undefined> =>
  db.recoverySnapshots.get(id);

/**
 * Emergency eviction after a quota failure: shrinks checkpoints to half, still keeping
 * the newest and the largest recent one (selectSnapshotsToEvict's protections).
 * Returns how many were removed; 0 means there was nothing safe to remove.
 */
export const freeCheckpointSpace = (db: SessionHubDb, now: Date): Promise<number> =>
  db.transaction("rw", db.recoverySnapshots, async () => {
    const metas = await snapshotMetas(db);
    const policy = { maxCount: Math.max(1, Math.floor(metas.length / 2)), maxAgeDays: RECOVERY_RETENTION.maxAgeDays };
    const evict = selectSnapshotsToEvict(metas, now, policy);
    await db.recoverySnapshots.bulkDelete(evict);
    return evict.length;
  });
