import { Dexie } from "dexie";
import type { BootstrapItem, PushResult, SyncWorkspacePayload } from "@sessionhub/contracts/api-sync";
import { apiWorkspaceSchema, type ApiWorkspace } from "@sessionhub/contracts/api-workspaces";
import type { AccountScope, LocalWorkspaceRecord, OutboxRecord, SessionHubDb, SessionUpload } from "./db";
import { clearWorkspaceFromQueue, entityOperations, requeueRefused, type OutboxContext } from "./outbox-repository";

/**
 * Workspace sync rules (docs/SYNC_PROTOCOL.md 13j, user's decisions of 2026-10-17). Edits merge per
 * field: an upload carries only the fields changed here, the server's state is shown with those
 * waiting fields on top, and after a conflict they are sent again on the newer version. Deletes win
 * over edits in both directions. Every function runs inside the caller's transaction, which must
 * include workspaces, sessions and outbox.
 */

/** The fields this browser changed and hasn't had accepted yet, newest value of each field last. */
const waitingFields = (operations: OutboxRecord[]): SyncWorkspacePayload =>
  operations.reduce<SyncWorkspacePayload>((fields, operation) => (operation.entityType === "workspace" && operation.action === "upsert" ? { ...fields, ...operation.payload } : fields), {});

/**
 * Forgets a workspace the account no longer has: the record, its unsent operations (a sent one
 * settles when its answer arrives) and every local assignment to it. The account had already moved
 * its sessions out (it refuses to delete a workspace that holds any), so sessions change only here,
 * and queued uploads that would put a session in it are cleared.
 */
export const forgetWorkspace = async (db: SessionHubDb, scope: AccountScope, id: string): Promise<void> => {
  const record = await db.workspaces.get(id);
  if (record && record.scope !== scope) return;
  await db.workspaces.delete(id);
  const unsent = (await entityOperations(db, scope, id)).filter((operation) => operation.status !== "sending");
  await db.outbox.bulkDelete(unsent.map((operation) => operation.seq ?? 0));
  const sessions = await db.sessions.where("[scope+updatedAt]").between([scope, Dexie.minKey], [scope, Dexie.maxKey]).toArray();
  for (const session of sessions) if (session.workspaceId === id) await db.sessions.update(session.id, { workspaceId: null });
  await clearWorkspaceFromQueue(db, scope, id);
};

/** Stores the server's workspace with this browser's waiting edits on top (a delete waiting here stays hidden). */
const writeServerWorkspace = async (db: SessionHubDb, scope: AccountScope, workspace: ApiWorkspace, version: number, previous: LocalWorkspaceRecord | undefined) => {
  const operations = await entityOperations(db, scope, workspace.id);
  const { id, name, description, icon, color, position, createdAt, updatedAt } = workspace;
  const waiting = operations.length > 0;
  await db.workspaces.put({
    id,
    scope,
    name,
    description,
    icon,
    color,
    position,
    createdAt,
    updatedAt: waiting ? (previous?.updatedAt ?? updatedAt) : updatedAt,
    ...waitingFields(operations),
    deletedAt: previous?.deletedAt ?? null,
    sync: { serverVersion: version, state: !waiting ? "synced" : previous?.sync.state === "error" ? "error" : "pending", lastError: waiting ? (previous?.sync.lastError ?? null) : null },
  });
};

/** Applies one pulled workspace change or bootstrap item; anything that doesn't validate is skipped. */
export const applyWorkspaceChange = async (db: SessionHubDb, scope: AccountScope, change: BootstrapItem): Promise<"applied" | "skipped"> => {
  const record = await db.workspaces.get(change.entityId);
  if (record && record.scope !== scope) return "skipped";
  if (change.action === "delete") {
    if (!record && (await entityOperations(db, scope, change.entityId)).length === 0) return "skipped";
    // Deletes win: an edit still waiting here goes with it.
    await forgetWorkspace(db, scope, change.entityId);
    return "applied";
  }
  const parsed = apiWorkspaceSchema.safeParse(change.payload);
  if (!parsed.success || parsed.data.id !== change.entityId) return "skipped";
  if (record && change.version <= (record.sync.serverVersion ?? 0)) return "skipped";
  await writeServerWorkspace(db, scope, parsed.data, change.version, record);
  return "applied";
};

/**
 * After the first bootstrap page, which carries every live workspace of the account: one this
 * browser has that isn't among them was deleted in the account, unless it has changes waiting here
 * (a create not accepted yet, or an edit or delete whose answer settles it).
 */
export const dropMissingWorkspaces = async (db: SessionHubDb, scope: AccountScope, live: Set<string>): Promise<void> => {
  for (const record of await db.workspaces.where("scope").equals(scope).toArray()) {
    if (live.has(record.id) || (await entityOperations(db, scope, record.id)).length > 0) continue;
    await forgetWorkspace(db, scope, record.id);
  }
};

/** After an accepted workspace operation (or a delete of something the account no longer has). */
const settleWorkspace = async (db: SessionHubDb, scope: AccountScope, operation: OutboxRecord, serverVersion: number | undefined) => {
  const record = await db.workspaces.get(operation.entityId);
  if (!record || record.scope !== scope) return;
  const rest = await entityOperations(db, scope, operation.entityId);
  if (operation.action === "delete") {
    if (rest.length === 0) await db.workspaces.delete(operation.entityId);
    return;
  }
  // The record shows the new version only if it held exactly the version this edit built on; after a
  // merge it lacks the other browser's fields, which the pull brings next.
  const exact = serverVersion !== undefined && (record.sync.serverVersion ?? 0) === operation.expectedVersion;
  await db.workspaces.update(operation.entityId, {
    sync: { serverVersion: exact ? serverVersion : record.sync.serverVersion, state: rest.length > 0 ? "pending" : "synced", lastError: null },
  });
};

/** An edit carries the refused fields under its own; a delete absorbs nothing (it wins). */
const absorbFields = (next: OutboxRecord, refused: OutboxRecord): OutboxRecord =>
  next.entityType === "workspace" && next.action === "upsert" && refused.entityType === "workspace" && refused.action === "upsert"
    ? { ...next, payload: { ...refused.payload, ...next.payload } }
    : next;

export type WorkspaceOutcome = "accepted" | "requeued" | "rejected" | "retryable";

/**
 * Applies the push result of one workspace operation (docs/SYNC_PROTOCOL.md 13j). Nothing here
 * needs the user: a conflict is merged and sent again, a workspace deleted elsewhere is forgotten,
 * a refused delete brings the workspace back. Only a create the account refuses (limit reached)
 * stays as `rejected`, shown on the workspace until the user removes it.
 */
export const applyWorkspaceResult = async (
  db: SessionHubDb,
  scope: AccountScope,
  operation: OutboxRecord,
  result: PushResult | undefined,
  context: OutboxContext,
): Promise<WorkspaceOutcome> => {
  if (!result || result.status === "retryable_error") return "retryable";
  const id = operation.entityId;
  const gone = result.status === "rejected" && result.code === "NOT_FOUND";
  if (result.status === "accepted" || (gone && operation.action === "delete")) {
    await db.outbox.delete(operation.seq ?? 0);
    await settleWorkspace(db, scope, operation, result.status === "accepted" ? result.serverVersion : undefined);
    return "accepted";
  }
  if (gone || (result.status === "conflict" && result.serverVersion === null)) {
    await db.outbox.delete(operation.seq ?? 0);
    await forgetWorkspace(db, scope, id);
    return "accepted";
  }
  if (result.status === "conflict" && result.serverVersion !== null) {
    const record = await db.workspaces.get(id);
    if (record?.scope === scope) await requeueRefused(db, operation, result.serverVersion, operation, absorbFields, context);
    else await db.outbox.delete(operation.seq ?? 0);
    return "requeued";
  }
  if (result.status === "rejected" && result.code === "WORKSPACE_NOT_EMPTY") {
    // Another browser put a session in it meanwhile: it stays, with that session (the pull brings it).
    await db.outbox.delete(operation.seq ?? 0);
    const rest = await entityOperations(db, scope, id);
    const record = await db.workspaces.get(id);
    if (record?.scope === scope) await db.workspaces.update(id, { deletedAt: null, sync: { ...record.sync, state: rest.length > 0 ? "pending" : "synced" } });
    return "accepted";
  }
  const message = result.message;
  await db.outbox.put({
    ...operation,
    status: "rejected",
    lastError: message,
    lastErrorCode: result.status === "validation_error" ? "VALIDATION_ERROR" : result.status === "rejected" ? result.code : null,
    updatedAt: context.now.toISOString(),
  });
  const record = await db.workspaces.get(id);
  if (record?.scope === scope) await db.workspaces.update(id, { sync: { ...record.sync, state: "error", lastError: message } });
  return "rejected";
};

/**
 * A session upload refused with INVALID_WORKSPACE: its workspace was deleted in the account while
 * this upload was on its way. The session itself still goes up, without that workspace (nothing to
 * decide: the workspace no longer exists anywhere), and the local assignment is cleared.
 */
export const requeueWithoutWorkspace = async (db: SessionHubDb, scope: AccountScope, operation: OutboxRecord, context: OutboxContext): Promise<void> => {
  if (operation.entityType !== "savedSession" || operation.action !== "upsert") return;
  const gone = operation.payload.workspaceId;
  const clear = (payload: SessionUpload): SessionUpload => (payload.workspaceId === gone ? { ...payload, workspaceId: null } : payload);
  const absorb = (next: OutboxRecord): OutboxRecord => (next.entityType === "savedSession" && next.action === "upsert" ? { ...next, payload: clear(next.payload) } : next);
  await requeueRefused(db, operation, operation.expectedVersion, { ...operation, payload: clear(operation.payload) }, absorb, context);
  const record = await db.sessions.get(operation.entityId);
  if (record?.scope === scope && record.workspaceId === gone) await db.sessions.update(record.id, { workspaceId: null });
};
