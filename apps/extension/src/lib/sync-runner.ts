import { pullNow, type PullSummary } from "./sync-downloader";
import type { SyncDeps } from "./sync-gate";
import { pushNow, type PushSummary } from "./sync-uploader";

export interface SyncSummary {
  push: PushSummary;
  /** Null when the push didn't complete (disconnected, sync off, waiting or failed). */
  pull: PullSummary | null;
}

let running: Promise<SyncSummary> | null = null;
let queued: Promise<SyncSummary> | null = null;
let queuedForce = false;

const start = (deps: SyncDeps, force: boolean): Promise<SyncSummary> => {
  const run: Promise<SyncSummary> = (async () => {
    const push = await pushNow(deps, { force });
    return { push, pull: push.status === "done" ? await pullNow(deps, { force }) : null };
  })().finally(() => {
    if (running === run) running = null;
  });
  running = run;
  return run;
};

/**
 * One sync run: upload first, then download (docs/SYNC_PROTOCOL.md section 7), so the pull also
 * brings back what was just accepted and held server copies settle against fresh versions. The
 * backoff belongs to the whole run: only the pull's success clears it. A call during a run doesn't
 * join it (its change may have missed the upload): exactly one more run starts right after, shared
 * by everyone who asked meanwhile.
 */
export const syncNow = (deps: SyncDeps, { force = false } = {}): Promise<SyncSummary> => {
  if (!running) return start(deps, force);
  queuedForce ||= force;
  queued ??= running
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => {
      const again = queuedForce;
      queued = null;
      queuedForce = false;
      return start(deps, again);
    });
  return queued;
};
