import { Dexie } from "dexie";
import type { SavedSession } from "@sessionhub/contracts/session";
import type { AccountScope, OutboxRecord, SessionHubDb } from "./db";

/** Time and ids for new operations, injected so tests are deterministic. */
export interface OutboxContext {
  now: Date;
  createId: () => string;
}

/** One account's pending operations, in upload order. Other accounts' operations never appear. */
export const listOutbox = (db: SessionHubDb, scope: AccountScope): Promise<OutboxRecord[]> =>
  db.outbox.where("[scope+seq]").between([scope, Dexie.minKey], [scope, Dexie.maxKey]).toArray();

const latestOperation = async (db: SessionHubDb, scope: AccountScope, entityId: string): Promise<OutboxRecord | undefined> => {
  const operations = await db.outbox.where("entityId").equals(entityId).toArray();
  return operations.filter((operation) => operation.scope === scope).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).at(-1);
};

/** Each accepted operation raises the server version by exactly 1, so later operations chain on it. */
const nextExpectedVersion = (latest: OutboxRecord | undefined, serverVersion: number | null): number =>
  latest ? latest.expectedVersion + 1 : (serverVersion ?? 0);

const newOperation = (scope: AccountScope, entityId: string, expectedVersion: number, context: OutboxContext) => ({
  id: context.createId(),
  scope,
  entityType: "savedSession" as const,
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
  session: SavedSession,
  serverVersion: number | null,
  context: OutboxContext,
): Promise<void> => {
  const latest = await latestOperation(db, scope, session.id);
  if (latest?.status === "queued" && latest.action === "upsert") {
    await db.outbox.put({ ...latest, payload: session, updatedAt: context.now.toISOString() });
    return;
  }
  await db.outbox.add({ ...newOperation(scope, session.id, nextExpectedVersion(latest, serverVersion), context), action: "upsert", payload: session });
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
    await db.outbox.put({ ...latest, action: "delete", payload: null, updatedAt: context.now.toISOString() });
    return true;
  }
  await db.outbox.add({ ...newOperation(scope, sessionId, nextExpectedVersion(latest, serverVersion), context), action: "delete", payload: null });
  return true;
};
