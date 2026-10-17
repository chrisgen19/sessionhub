import type { BootstrapItem } from "@sessionhub/contracts/api-sync";
import { AccountApiError, fetchSyncBootstrap, fetchSyncPull } from "./account-api";
import type { AccountScope, SessionHubDb, SyncStateRecord } from "./db";
import { applyRemoteChange, type ApplyOutcome } from "./sync-apply";
import { isRunAccount, openSync, recordFailure, recordSuccess, withRunToken, type GateClosed, type SyncDeps, type SyncFailure } from "./sync-gate";

export type PullSummary = GateClosed | SyncFailure | { status: "done"; applied: number; held: number; skipped: number; bootstrapped: boolean };

/** Pages per run, so one run can't occupy the worker indefinitely; the rest follows shortly. */
const MAX_PAGES = 20;
const FOLLOW_UP_MS = 30_000;

type Tally = Record<ApplyOutcome, number>;

/**
 * Applies a page and moves the stored position in one transaction (docs/SYNC_PROTOCOL.md section 3,
 * invariant 7): if anything fails, neither the changes nor the cursor are kept and the page is
 * fetched again. `expect` guards against another run having moved the position meanwhile, and
 * a page is dropped if a different account was connected while it was in flight.
 */
const commitPage = (
  db: SessionHubDb,
  scope: AccountScope,
  expect: (state: SyncStateRecord | undefined) => boolean,
  items: BootstrapItem[],
  next: Partial<SyncStateRecord>,
  now: string,
): Promise<Tally | null> =>
  db.transaction("rw", [db.sessions, db.outbox, db.sessionTombstones, db.serverCopies, db.syncState, db.account], async () => {
    if (!isRunAccount(await db.account.get("connection"), scope) || !expect(await db.syncState.get(scope))) return null;
    const tally: Tally = { applied: 0, held: 0, skipped: 0 };
    for (const item of items) tally[await applyRemoteChange(db, scope, item, now)] += 1;
    await db.syncState.update(scope, next);
    return tally;
  });

/** One pull page after the stored cursor. Returns whether more pages are waiting. */
const pullStep = async (deps: SyncDeps, scope: AccountScope, cursor: string, total: Tally): Promise<boolean> => {
  const page = await withRunToken(deps, scope, (token, origin) => fetchSyncPull(deps.account.fetch, origin, token, cursor));
  const now = deps.now().toISOString();
  const tally = await commitPage(deps.db, scope, (state) => state?.cursor === cursor && !state.bootstrap, page.changes, { cursor: page.nextCursor, lastSyncAt: now }, now);
  if (tally) for (const key of Object.keys(total) as ApplyOutcome[]) total[key] += tally[key];
  return page.hasMore;
};

/**
 * One bootstrap page. Progress is durable, so a worker stopped mid-rebuild continues where it was.
 * The first page's cursor is kept: pulling resumes from it after the last page.
 */
const bootstrapStep = async (deps: SyncDeps, scope: AccountScope, progress: SyncStateRecord["bootstrap"], total: Tally): Promise<void> => {
  const page = await withRunToken(deps, scope, (token, origin) => fetchSyncBootstrap(deps.account.fetch, origin, token, progress?.after ?? null));
  const now = deps.now().toISOString();
  const cursor = progress?.cursor ?? page.cursor;
  const next = page.hasMore ? { bootstrap: { cursor, after: page.nextAfter } } : { cursor, bootstrap: null, lastSyncAt: now };
  const same = (state: SyncStateRecord | undefined) => (state?.bootstrap?.after ?? null) === (progress?.after ?? null) && (state?.bootstrap?.cursor ?? null) === (progress?.cursor ?? null);
  const tally = await commitPage(deps.db, scope, same, page.items, next, now);
  if (tally) for (const key of Object.keys(total) as ApplyOutcome[]) total[key] += tally[key];
};

const run = async (deps: SyncDeps, force: boolean): Promise<PullSummary> => {
  const gate = await openSync(deps, force);
  if ("status" in gate) return gate;
  const { scope } = gate;
  const total: Tally = { applied: 0, held: 0, skipped: 0 };
  let bootstrapped = false;
  let finished = false;
  for (let page = 0; page < MAX_PAGES && !finished; page += 1) {
    const state = await deps.db.syncState.get(scope);
    try {
      if (!state?.cursor || state.bootstrap) {
        bootstrapped = true;
        await bootstrapStep(deps, scope, state?.bootstrap ?? null, total);
      } else {
        finished = !(await pullStep(deps, scope, state.cursor, total));
      }
    } catch (error) {
      if (!(error instanceof AccountApiError)) throw error;
      // The server can't continue from this cursor: rebuild from a full copy. Queued local
      // changes are untouched (pull never overwrites them).
      if (error.code === "CURSOR_EXPIRED" || error.code === "INVALID_CURSOR") {
        await deps.db.syncState.update(scope, { cursor: null, bootstrap: null });
        continue;
      }
      return recordFailure(deps, scope, error);
    }
  }
  await recordSuccess(deps, scope);
  if (!finished) await deps.scheduleRetry(new Date(deps.now().getTime() + FOLLOW_UP_MS)).catch(() => undefined);
  return { status: "done", ...total, bootstrapped };
};

let running: Promise<PullSummary> | null = null;

/**
 * Downloads the connected account's changes into its local scope (docs/SYNC_PROTOCOL.md section 7,
 * pull half): bootstrap when there is no usable cursor, then pages after the cursor. One run at a
 * time in this worker; `force` (Sync now) ignores the backoff wait.
 */
export const pullNow = (deps: SyncDeps, { force = false } = {}): Promise<PullSummary> => {
  running ??= run(deps, force).finally(() => {
    running = null;
  });
  return running;
};
