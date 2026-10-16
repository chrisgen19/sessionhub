import { SYNC_PROTOCOL_VERSION, type PushResult } from "@sessionhub/contracts/api-sync";
import { AccountApiError, pushChanges } from "./account-api";
import { withAccessToken } from "./account-service";
import type { AccountScope, OutboxRecord, SessionHubDb, SessionSyncRecord } from "./db";
import { listOutbox } from "./outbox-repository";
import { settleHeldCopy } from "./sync-apply";
import { selectPushBatch, toPushOperation } from "./sync-batch";
import { openSync, recordFailure, recordSuccess, type GateClosed, type SyncDeps, type SyncFailure } from "./sync-gate";

export type PushSummary = GateClosed | SyncFailure | { status: "done"; accepted: number; conflicts: number; rejected: number; remaining: number };

/** Rounds per run, so one run can't occupy the worker indefinitely. */
const MAX_ROUNDS = 10;
const TOO_LARGE = "This session is too large to sync (over 1.5 MB of tabs).";

/**
 * Claims the next batch in one transaction: `sending` (and attempts + 1) is committed before the
 * request leaves (docs/SYNC_PROTOCOL.md 13e), so a worker killed mid-request resends the same content.
 */
const claimBatch = (db: SessionHubDb, scope: AccountScope, now: string): Promise<OutboxRecord[]> =>
  db.transaction("rw", [db.outbox, db.sessions], async () => {
    const { operations, tooLarge } = selectPushBatch(await listOutbox(db, scope));
    for (const operation of tooLarge) {
      await db.outbox.put({ ...operation, status: "rejected", lastError: TOO_LARGE, updatedAt: now });
      await setSessionState(db, scope, operation.entityId, "error");
    }
    const claimed = operations.map((operation) => ({ ...operation, status: "sending" as const, attempts: operation.attempts + 1, updatedAt: now }));
    await db.outbox.bulkPut(claimed);
    return claimed;
  });

const setSessionState = async (db: SessionHubDb, scope: AccountScope, id: string, state: SessionSyncRecord["state"], serverVersion?: number) => {
  const record = await db.sessions.get(id);
  if (!record || record.scope !== scope) return;
  const known = record.sync?.serverVersion ?? null;
  const version = serverVersion === undefined ? known : Math.max(known ?? 0, serverVersion);
  await db.sessions.update(id, { sync: { serverVersion: version, state } });
};

/**
 * After an accepted operation: synced once nothing else is waiting, otherwise still pending. A
 * server copy held while it was pending is settled too: a newer one is applied now, because the
 * pull cursor already passed it (pull echo reconciliation).
 */
const settleSession = async (db: SessionHubDb, scope: AccountScope, id: string, serverVersion: number | undefined) => {
  const rest = (await db.outbox.where("entityId").equals(id).toArray()).filter((operation) => operation.scope === scope);
  if (serverVersion !== undefined && (await settleHeldCopy(db, scope, id, serverVersion, rest.length)) === "applied") return;
  const held = rest.find((operation) => operation.status === "conflict" || operation.status === "rejected");
  await setSessionState(db, scope, id, held ? (held.status === "conflict" ? "conflict" : "error") : rest.length > 0 ? "pending" : "synced", serverVersion);
};

type Tally = { accepted: number; conflicts: number; rejected: number; retryable: number };

/** Applies one push's results in one transaction. A missing result counts as retryable (stays `sending`). */
const applyResults = (db: SessionHubDb, scope: AccountScope, claimed: OutboxRecord[], results: PushResult[], now: string): Promise<Tally> =>
  db.transaction("rw", [db.outbox, db.sessions, db.serverCopies, db.sessionTombstones], async () => {
    const byId = new Map(results.map((result) => [result.clientOperationId, result]));
    const tally: Tally = { accepted: 0, conflicts: 0, rejected: 0, retryable: 0 };
    for (const operation of claimed) {
      const result = byId.get(operation.id);
      if (!result || result.status === "retryable_error") {
        tally.retryable += 1;
      } else if (result.status === "accepted" || (result.status === "rejected" && result.code === "NOT_FOUND" && operation.action === "delete")) {
        // A delete of something the server doesn't have is done too.
        await db.outbox.where("id").equals(operation.id).delete();
        await settleSession(db, scope, operation.entityId, result.status === "accepted" ? result.serverVersion : undefined);
        tally.accepted += 1;
      } else {
        const conflict = result.status === "conflict" || result.status === "rejected";
        await db.outbox.put({ ...operation, status: result.status === "conflict" ? "conflict" : "rejected", lastError: result.message, updatedAt: now });
        await setSessionState(db, scope, operation.entityId, conflict ? "conflict" : "error");
        if (result.status === "conflict") tally.conflicts += 1;
        else tally.rejected += 1;
      }
    }
    return tally;
  });

const run = async (deps: SyncDeps, force: boolean): Promise<PushSummary> => {
  // Consent gate: nothing leaves this browser until the user turned sync on for this account.
  const gate = await openSync(deps, force);
  if ("status" in gate) return gate;
  const { connection, scope } = gate;
  const total = { accepted: 0, conflicts: 0, rejected: 0 };
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const claimed = await claimBatch(deps.db, scope, deps.now().toISOString());
    if (claimed.length === 0) break;
    const request = { protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: connection.deviceId, operations: claimed.map(toPushOperation) };
    let tally: Tally;
    try {
      const response = await withAccessToken(deps.account, (token, origin) => pushChanges(deps.account.fetch, origin, token, request));
      tally = await applyResults(deps.db, scope, claimed, response.results, deps.now().toISOString());
    } catch (error) {
      if (!(error instanceof AccountApiError)) throw error;
      return recordFailure(deps, scope, error);
    }
    total.accepted += tally.accepted;
    total.conflicts += tally.conflicts;
    total.rejected += tally.rejected;
    if (tally.retryable > 0) return recordFailure(deps, scope, new AccountApiError("INTERNAL_ERROR", "Some changes couldn't be saved yet. They will be sent again."));
  }
  await recordSuccess(deps, scope);
  const outbox = await listOutbox(deps.db, scope);
  // The round cap ended this run with sendable work left: the retry alarm continues it instead of
  // waiting for the next edit or worker start. Work held back behind a conflict doesn't count.
  if (selectPushBatch(outbox).operations.length > 0) await deps.scheduleRetry(deps.now()).catch(() => undefined);
  const remaining = outbox.filter((operation) => operation.status === "queued" || operation.status === "sending").length;
  return { status: "done", ...total, remaining };
};

let running: Promise<PushSummary> | null = null;

/**
 * Uploads the connected account's queued changes (docs/SYNC_PROTOCOL.md section 7, push half). One run at a
 * time in this worker; a call during a run shares it. `force` (Sync now) ignores the backoff wait.
 * Safety never depends on this: operations are idempotent by id on the server.
 */
export const pushNow = (deps: SyncDeps, { force = false } = {}): Promise<PushSummary> => {
  running ??= run(deps, force).finally(() => {
    running = null;
  });
  return running;
};
