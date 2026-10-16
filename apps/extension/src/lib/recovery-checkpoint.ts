import { buildSavedSession, CaptureLimitError } from "@sessionhub/core/capture";
import { defaultSessionName } from "@sessionhub/core/naming";
import { fingerprintCapture } from "@sessionhub/core/recovery";
import type { HandlerDeps } from "./command-handlers";
import type { RecoverySnapshotRecord } from "./db";
import { getOrCreateDevice } from "./device-repository";
import { commitCheckpoint, getRecoveryState, recordRecoveryError, type CheckpointOutcome } from "./recovery-repository";

export type CheckpointResult =
  | { status: "clean" }
  | { status: CheckpointOutcome; snapshotId: string | null; stillDirty: boolean }
  | { status: "error"; message: string };

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
    const { outcome, stillDirty } = await commitCheckpoint(deps.db, { snapshot, fingerprint, startedAt });
    return { status: outcome, snapshotId: outcome === "created" ? session.id : null, stillDirty };
  } catch (error) {
    const message =
      error instanceof CaptureLimitError ? error.message : error instanceof Error ? error.message : "Checkpoint failed";
    await recordRecoveryError(deps.db, message).catch(() => undefined);
    return { status: "error", message };
  }
};
