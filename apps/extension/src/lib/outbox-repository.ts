import { Dexie } from "dexie";
import type { SyncWorkspacePayload } from "@sessionhub/contracts/api-sync";
import type { AccountScope, OutboxRecord, SessionHubDb, SessionUpload } from "./db";

/** Time and ids for new operations, injected so tests are deterministic. */
export interface OutboxContext {
  now: Date;
  createId: () => string;
}

/** One account's pending operations, in upload order. Other accounts' operations never appear. */
export const listOutbox = (db: SessionHubDb, scope: AccountScope): Promise<OutboxRecord[]> =>
  db.outbox.where("[scope+seq]").between([scope, Dexie.minKey], [scope, Dexie.maxKey]).toArray();

/** One entity's pending operations in this account, in upload order. */
export const entityOperations = async (db: SessionHubDb, scope: AccountScope, entityId: string): Promise<OutboxRecord[]> =>
  (await db.outbox.where("entityId").equals(entityId).toArray()).filter((operation) => operation.scope === scope).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

const latestOperation = async (db: SessionHubDb, scope: AccountScope, entityId: string): Promise<OutboxRecord | undefined> =>
  (await entityOperations(db, scope, entityId)).at(-1);

/** Each accepted operation raises the server version by exactly 1, so later operations chain on it. */
const nextExpectedVersion = (latest: OutboxRecord | undefined, serverVersion: number | null): number =>
  latest ? latest.expectedVersion + 1 : (serverVersion ?? 0);

const newOperation = (scope: AccountScope, entityId: string, expectedVersion: number, context: OutboxContext) => ({
  id: context.createId(),
  scope,
  entityId,
  expectedVersion,
  status: "queued" as const,
  createdAt: context.now.toISOString(),
  updatedAt: context.now.toISOString(),
  attempts: 0,
  nextAttemptAt: null,
  lastError: null,
});

/**
 * Queues an upload of an account-scoped session's current content. While the session's latest
 * operation is still `queued` it is updated in place (same id and base version, newest content);
 * after it was handed to the network a new operation is appended. Call inside the transaction
 * that writes the session, with `outbox` in its table list.
 */
export const enqueueSessionUpsert = async (
  db: SessionHubDb,
  scope: AccountScope,
  session: SessionUpload,
  serverVersion: number | null,
  context: OutboxContext,
): Promise<void> => {
  const latest = await latestOperation(db, scope, session.id);
  if (latest?.status === "queued" && latest.entityType === "savedSession" && latest.action === "upsert") {
    await db.outbox.put({ ...latest, payload: session, updatedAt: context.now.toISOString() });
    return;
  }
  await db.outbox.add({ ...newOperation(scope, session.id, nextExpectedVersion(latest, serverVersion), context), entityType: "savedSession", action: "upsert", payload: session });
};

/**
 * Queues the server-side delete of an account-scoped session. Returns false when the server can't
 * know the session because its create was never sent: that create is dropped and nothing about
 * the session is ever uploaded. Call inside the transaction that deletes the session.
 */
export const enqueueSessionDelete = async (
  db: SessionHubDb,
  scope: AccountScope,
  sessionId: string,
  serverVersion: number | null,
  context: OutboxContext,
): Promise<boolean> => {
  const latest = await latestOperation(db, scope, sessionId);
  if (latest?.status === "queued" && latest.action === "upsert") {
    // A queued create has nothing before it (versions chain from 0).
    if (latest.expectedVersion === 0) {
      await db.outbox.where("id").equals(latest.id).delete();
      return false;
    }
    await db.outbox.put({ ...latest, entityType: "savedSession", action: "delete", payload: null, updatedAt: context.now.toISOString() });
    return true;
  }
  await db.outbox.add({ ...newOperation(scope, sessionId, nextExpectedVersion(latest, serverVersion), context), entityType: "savedSession", action: "delete", payload: null });
  return true;
};

/**
 * Queues a workspace edit carrying only the changed fields (docs/SYNC_PROTOCOL.md 13j): merged into
 * a still-`queued` upsert (the newest value of each field wins), else appended. Call inside the
 * transaction that writes the workspace.
 */
export const enqueueWorkspaceUpsert = async (
  db: SessionHubDb,
  scope: AccountScope,
  workspaceId: string,
  changes: SyncWorkspacePayload,
  serverVersion: number | null,
  context: OutboxContext,
): Promise<void> => {
  const latest = await latestOperation(db, scope, workspaceId);
  if (latest?.status === "queued" && latest.entityType === "workspace" && latest.action === "upsert") {
    await db.outbox.put({ ...latest, payload: { ...latest.payload, ...changes }, updatedAt: context.now.toISOString() });
    return;
  }
  await db.outbox.add({ ...newOperation(scope, workspaceId, nextExpectedVersion(latest, serverVersion), context), entityType: "workspace", action: "upsert", payload: changes });
};

/**
 * Queues a workspace's delete after the unassignments of `waitFor` (queued just before, in the same
 * transaction). Unsent or refused edits of it are dropped: the delete supersedes them and so lands
 * after the unassignments in queue order. Returns false when the account never got the workspace
 * (no accepted create, none in flight): then its operations are dropped and nothing is sent.
 */
export const enqueueWorkspaceDelete = async (
  db: SessionHubDb,
  scope: AccountScope,
  workspaceId: string,
  serverVersion: number | null,
  waitFor: string[],
  context: OutboxContext,
): Promise<boolean> => {
  const operations = await entityOperations(db, scope, workspaceId);
  const sending = operations.filter((operation) => operation.status === "sending").at(-1);
  await db.outbox.bulkDelete(operations.filter((operation) => operation.status !== "sending").map((operation) => operation.seq ?? 0));
  if (serverVersion === null && !sending) return false;
  const expectedVersion = sending ? sending.expectedVersion + 1 : (serverVersion ?? 0);
  await db.outbox.add({ ...newOperation(scope, workspaceId, expectedVersion, context), entityType: "workspace", action: "delete", payload: null, waitFor });
  return true;
};

/**
 * Sends a refused change again on `base`, under a new id (the refused id keeps its receipt on the
 * server): the refused operation is removed, and the entity's later operations, which chained on it,
 * move onto `base`, the first absorbing `change` (its own fields win); with none left, `change` is
 * queued anew. Used where the protocol resolves on its own: workspace edits after a conflict, and a
 * session whose workspace was deleted elsewhere (docs/SYNC_PROTOCOL.md 13j).
 */
export const requeueRefused = async (
  db: SessionHubDb,
  refused: OutboxRecord,
  base: number,
  change: OutboxRecord,
  absorb: (next: OutboxRecord, change: OutboxRecord) => OutboxRecord,
  context: OutboxContext,
): Promise<void> => {
  await db.outbox.delete(refused.seq ?? 0);
  const rest = await entityOperations(db, refused.scope, refused.entityId);
  const now = context.now.toISOString();
  if (rest.length === 0) {
    const { seq: _seq, ...fields } = change;
    await db.outbox.add({ ...fields, ...newOperation(refused.scope, refused.entityId, base, context), lastErrorCode: null, conflictServerVersion: null });
    return;
  }
  for (const [index, operation] of rest.entries()) {
    const next = index === 0 ? absorb(operation, change) : operation;
    await db.outbox.put({ ...next, expectedVersion: base + index, updatedAt: now });
  }
};

/**
 * Takes a workspace that no longer exists in the account out of queued session uploads (they would
 * be refused). Uploads already sent can't change: the uploader handles their refusal.
 */
export const clearWorkspaceFromQueue = async (db: SessionHubDb, scope: AccountScope, workspaceId: string): Promise<void> => {
  for (const operation of await listOutbox(db, scope)) {
    if (operation.status !== "queued" || operation.entityType !== "savedSession" || operation.action !== "upsert") continue;
    if (operation.payload.workspaceId === workspaceId) await db.outbox.put({ ...operation, payload: { ...operation.payload, workspaceId: null } });
  }
};
