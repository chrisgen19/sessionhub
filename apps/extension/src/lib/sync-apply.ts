import { apiSessionDetailSchema, type ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import type { BootstrapItem } from "@sessionhub/contracts/api-sync";
import { savedSessionSchema } from "@sessionhub/contracts/session";
import { reconcileHeldCopy, reconcileRemoteChange, toLocalSession, type LocalEntity } from "@sessionhub/sync/reconcile";
import type { AccountScope, LocalSessionRecord, SessionHubDb } from "./db";
import { applyWorkspaceChange } from "./workspace-sync";

/**
 * Applies server state to the local cache following `@sessionhub/sync` rules. Every function here
 * runs inside the caller's transaction, which must include sessions, outbox, sessionTombstones,
 * serverCopies and workspaces. Nothing here touches the browser: a pull never opens or closes tabs.
 */

const readLocalEntity = async (db: SessionHubDb, scope: AccountScope, id: string): Promise<{ entity: LocalEntity; record?: LocalSessionRecord }> => {
  const record = await db.sessions.get(id);
  const operations = await db.outbox.where("entityId").equals(id).toArray();
  const tombstone = await db.sessionTombstones.get(id);
  const copy = await db.serverCopies.get(id);
  const entity: LocalEntity = {
    recordScope: record?.scope ?? null,
    serverVersion: record?.scope === scope ? (record.sync?.serverVersion ?? null) : null,
    pendingOperations: operations.filter((operation) => operation.scope === scope).length,
    tombstone: tombstone?.scope === scope,
    serverCopyVersion: copy?.scope === scope ? copy.version : null,
  };
  return { entity, record };
};

/** Stores the server's session as a synced local record (dropping its held copy); false if it doesn't fit the local schema. */
export const writeServerSession = async (db: SessionHubDb, scope: AccountScope, detail: ApiSessionDetail, version: number, previous?: LocalSessionRecord): Promise<boolean> => {
  const session = savedSessionSchema.safeParse(toLocalSession(detail, previous?.scope === scope ? previous.version : null));
  if (!session.success) return false;
  await db.sessions.put({ ...session.data, scope, sync: { serverVersion: version, state: "synced" }, workspaceId: detail.workspaceId });
  await db.serverCopies.delete(detail.id);
  return true;
};

export type ApplyOutcome = "applied" | "held" | "skipped";

/**
 * Applies one pulled change or bootstrap item. Anything it can't read (another entity type, a
 * payload that doesn't validate) is skipped, so one bad change can never block a page forever.
 */
export const applyRemoteChange = async (db: SessionHubDb, scope: AccountScope, change: BootstrapItem, now: string): Promise<ApplyOutcome> => {
  if (change.entityType === "workspace") return applyWorkspaceChange(db, scope, change);
  let detail: ApiSessionDetail | null = null;
  if (change.action === "upsert") {
    const parsed = apiSessionDetailSchema.safeParse(change.payload);
    if (!parsed.success || parsed.data.id !== change.entityId) return "skipped";
    detail = parsed.data;
  }
  const { entity, record } = await readLocalEntity(db, scope, change.entityId);
  // A session cached before workspaces were stored learns its workspace from the same version
  // (the v6 rebuild), even though the version itself is not new.
  if (detail && record?.scope === scope && record.workspaceId === undefined && record.sync?.serverVersion === change.version) {
    await db.sessions.update(record.id, { workspaceId: detail.workspaceId });
  }
  const decision = reconcileRemoteChange(scope, entity, change);
  switch (decision.kind) {
    case "write":
      return detail && (await writeServerSession(db, scope, detail, change.version, record)) ? "applied" : "skipped";
    case "remove":
      await db.sessions.delete(change.entityId);
      await db.serverCopies.delete(change.entityId);
      return "applied";
    case "purge-tombstone":
      await db.sessionTombstones.delete(change.entityId);
      return "applied";
    case "hold":
      await db.serverCopies.put({ id: change.entityId, scope, action: change.action, version: change.version, payload: detail, receivedAt: now });
      return "held";
    case "skip":
      return "skipped";
  }
};

/**
 * After the server accepted a local operation: settles a server copy held meanwhile (its own echo
 * is dropped, a newer one is applied once nothing else is waiting). `pendingOperations` counts what
 * is still queued for this session after the accepted operation was removed.
 */
export const settleHeldCopy = async (db: SessionHubDb, scope: AccountScope, id: string, acceptedVersion: number, pendingOperations: number): Promise<"applied" | "none"> => {
  const copy = await db.serverCopies.get(id);
  if (!copy || copy.scope !== scope) return "none";
  const decision = reconcileHeldCopy(copy, acceptedVersion, pendingOperations);
  if (decision === "keep") return "none";
  if (decision === "drop" || decision === "drop-and-purge-tombstone") {
    await db.serverCopies.delete(id);
    if (decision === "drop-and-purge-tombstone") await db.sessionTombstones.delete(id);
    return "none";
  }
  if (copy.action === "delete" || !copy.payload) {
    await db.sessions.delete(id);
    await db.serverCopies.delete(id);
    return "applied";
  }
  const written = await writeServerSession(db, scope, copy.payload, copy.version, await db.sessions.get(id));
  if (!written) await db.serverCopies.delete(id);
  return written ? "applied" : "none";
};
