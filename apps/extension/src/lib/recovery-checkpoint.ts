import { buildSavedSession, CaptureLimitError } from "@sessionhub/core/capture";
import { defaultSessionName } from "@sessionhub/core/naming";
import { fingerprintCapture } from "@sessionhub/core/recovery";
import type { HandlerDeps } from "./command-handlers";
import type { RecoverySnapshotRecord } from "./db";
import { getOrCreateDevice } from "./device-repository";
import {
  commitCheckpoint,
  freeCheckpointSpace,
  getRecoveryState,
  recordRecoveryError,
  type CheckpointOutcome,
  type CommitCheckpointInput,
} from "./recovery-repository";
import { isQuotaError } from "./storage-errors";

/** `removed` is how many older checkpoints were already evicted (and committed) before this failure. */
class CheckpointStorageFullError extends Error {
  override name = "CheckpointStorageFullError";
  constructor(cause: unknown, removed = 0) {
    super(
      removed === 0
        ? "Storage for SessionHub is full, so this checkpoint wasn't saved. Earlier checkpoints are kept. Delete or export sessions you no longer need."
        : `Storage for SessionHub is full, so this checkpoint wasn't saved, even after removing ${removed} older checkpoint${removed === 1 ? "" : "s"} to make room. Delete or export sessions you no longer need.`,
      { cause },
    );
  }
}

export type CheckpointResult =
  | { status: "clean" }
  | { status: CheckpointOutcome; snapshotId: string | null; stillDirty: boolean; freedForSpace: number }
  | { status: "error"; message: string; storageFull: boolean };

/**
 * Commits a checkpoint; if storage is full, evicts older checkpoints (never the newest
 * or largest recent one) and retries exactly once. The failed attempt's transaction
 * aborted, so it removed nothing on its own, but the eviction is committed separately,
 * so a failed retry must still say how many were removed.
 */
const commitWithSpaceRecovery = async (db: Parameters<typeof commitCheckpoint>[0], input: CommitCheckpointInput) => {
  try {
    return { committed: await commitCheckpoint(db, input), freedForSpace: 0 };
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    const freedForSpace = await freeCheckpointSpace(db, input.startedAt);
    if (freedForSpace === 0) throw new CheckpointStorageFullError(error);
    try {
      return { committed: await commitCheckpoint(db, input), freedForSpace };
    } catch (retryError) {
      throw isQuotaError(retryError) ? new CheckpointStorageFullError(retryError, freedForSpace) : retryError;
    }
  }
};

/**
 * Takes a recovery checkpoint of all normal windows. Automatic runs (`force: false`)
 * do nothing unless the durable dirty flag is set. Never throws: failures are recorded
 * in recovery state so the Recovery view can show them.
 */
export const runCheckpoint = async (
  deps: Pick<HandlerDeps, "db" | "readWindows" | "now" | "createId">,
  options: { force: boolean; reason: RecoverySnapshotRecord["reason"] },
): Promise<CheckpointResult> => {
  try {
    if (!options.force && !(await getRecoveryState(deps.db)).dirty) return { status: "clean" };
    const startedAt = deps.now();
    const windows = await deps.readWindows({ kind: "all-windows" });
    const fingerprint = fingerprintCapture(windows);
    const device = await getOrCreateDevice(deps.db, deps.createId, startedAt);
    const { session, report } = buildSavedSession(windows, {
      name: defaultSessionName("checkpoint", startedAt),
      now: startedAt,
      device: { id: device.installationId, name: device.friendlyName },
      createId: deps.createId,
    });
    const snapshot: RecoverySnapshotRecord | null =
      report.tabCount === 0
        ? null
        : {
            id: session.id,
            capturedAt: startedAt.toISOString(),
            reason: options.reason,
            fingerprint,
            windowCount: report.windowCount,
            tabCount: report.tabCount,
            session,
          };
    const { committed, freedForSpace } = await commitWithSpaceRecovery(deps.db, { snapshot, fingerprint, startedAt });
    const { outcome, stillDirty } = committed;
    return { status: outcome, snapshotId: outcome === "created" ? session.id : null, stillDirty, freedForSpace };
  } catch (error) {
    const message =
      error instanceof CaptureLimitError ? error.message : error instanceof Error ? error.message : "Checkpoint failed";
    await recordRecoveryError(deps.db, message).catch(() => undefined);
    return { status: "error", message, storageFull: error instanceof CheckpointStorageFullError };
  }
};
