import { pullNow, type PullSummary } from "./sync-downloader";
import type { SyncDeps } from "./sync-gate";
import { pushNow, type PushSummary } from "./sync-uploader";

export interface SyncSummary {
  push: PushSummary;
  /** Null when the push didn't complete (disconnected, sync off, waiting or failed). */
  pull: PullSummary | null;
}

let running: Promise<SyncSummary> | null = null;

/**
 * One sync run: upload first, then download (docs/SYNC_PROTOCOL.md section 7), so the pull also
 * brings back what was just accepted and held server copies settle against fresh versions.
 */
export const syncNow = (deps: SyncDeps, { force = false } = {}): Promise<SyncSummary> => {
  running ??= (async () => {
    const push = await pushNow(deps, { force });
    return { push, pull: push.status === "done" ? await pullNow(deps, { force }) : null };
  })().finally(() => {
    running = null;
  });
  return running;
};
