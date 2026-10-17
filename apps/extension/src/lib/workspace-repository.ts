import { Dexie } from "dexie";
import type { SyncWorkspacePayload } from "@sessionhub/contracts/api-sync";
import { WORKSPACE_LIMITS, workspaceFieldSchemas } from "@sessionhub/contracts/api-workspaces";
import type { TabGroupColor } from "@sessionhub/contracts/session";
import { activeAccountScope } from "./account-scope";
import type { AccountScope, LocalSessionRecord, LocalWorkspaceRecord, SessionHubDb } from "./db";
import { enqueueSessionUpsert, enqueueWorkspaceDelete, enqueueWorkspaceUpsert, type OutboxContext } from "./outbox-repository";
import { SessionNotFoundError } from "./session-repository";
import { SyncUnavailableError } from "./sync-consent";

/**
 * The connected account's workspaces in this browser (docs/SYNC_PROTOCOL.md 13j). Workspaces are
 * account only: every change commits with its queued upload in one transaction, like sessions.
 */

export class WorkspaceNotFoundError extends Error {
  override name = "WorkspaceNotFoundError";
}

export class InvalidWorkspaceError extends Error {
  override name = "InvalidWorkspaceError";
}

/** The server's list order: position, then creation time, then id. */
const byDisplayOrder = (a: LocalWorkspaceRecord, b: LocalWorkspaceRecord) =>
  a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export interface WorkspacesSnapshot {
  /** Connected to an account (its id known): workspaces can be used. */
  connected: boolean;
  /** Sync is on for that account in this browser. */
  syncEnabled: boolean;
  workspaces: LocalWorkspaceRecord[];
}

/** The connected account's workspaces, in display order, without ones deleted here. Safe inside liveQuery. */
export const readWorkspaces = async (db: SessionHubDb): Promise<WorkspacesSnapshot> => {
  const scope = activeAccountScope(await db.account.get("connection"));
  if (!scope) return { connected: false, syncEnabled: false, workspaces: [] };
  const syncEnabled = Boolean((await db.syncState.get(scope))?.enabledAt);
  const records = await db.workspaces.where("scope").equals(scope).toArray();
  return { connected: true, syncEnabled, workspaces: records.filter((record) => !record.deletedAt).sort(byDisplayOrder) };
};

const requireScope = async (db: SessionHubDb): Promise<AccountScope> => {
  const scope = activeAccountScope(await db.account.get("connection"));
  if (!scope) throw new SyncUnavailableError("Connect this browser to your account first: workspaces belong to your account.");
  return scope;
};

const parseName = (name: string): string => {
  const parsed = workspaceFieldSchemas.name.safeParse(name);
  if (!parsed.success) throw new InvalidWorkspaceError(parsed.error.issues[0]?.message ?? "Enter a name");
  return parsed.data;
};

const liveWorkspace = async (db: SessionHubDb, scope: AccountScope, id: string): Promise<LocalWorkspaceRecord> => {
  const record = await db.workspaces.get(id);
  if (!record || record.scope !== scope || record.deletedAt) throw new WorkspaceNotFoundError("This workspace no longer exists.");
  return record;
};

const pendingState = (record: LocalSessionRecord) => (record.sync?.state === "conflict" ? "conflict" : "pending");

/** Moves an account session in or out of a workspace and queues its upload (inside the caller's transaction). */
const setSessionWorkspace = async (db: SessionHubDb, scope: AccountScope, record: LocalSessionRecord, workspaceId: string | null, context: OutboxContext) => {
  const { scope: _scope, sync, workspaceId: _previous, ...session } = record;
  const serverVersion = sync?.serverVersion ?? null;
  await enqueueSessionUpsert(db, scope, { ...session, workspaceId }, serverVersion, context);
  await db.sessions.update(record.id, { workspaceId, sync: { serverVersion, state: pendingState(record) } });
};

/** Creates a workspace in the connected account, with its create queued. */
export const createWorkspace = (db: SessionHubDb, input: { name: string; color: TabGroupColor | null }, context: OutboxContext): Promise<{ workspaceId: string }> =>
  db.transaction("rw", [db.account, db.workspaces, db.outbox], async () => {
    const scope = await requireScope(db);
    const name = parseName(input.name);
    // A workspace deleted here still counts until the account accepts the delete, which may wait for
    // its sessions to move out: a create sent meanwhile would pass the account's limit.
    const records = await db.workspaces.where("scope").equals(scope).toArray();
    if (records.length >= WORKSPACE_LIMITS.perUserMax) {
      const live = records.filter((record) => !record.deletedAt).length;
      throw new InvalidWorkspaceError(
        live >= WORKSPACE_LIMITS.perUserMax
          ? `You can have up to ${WORKSPACE_LIMITS.perUserMax} workspaces. Delete one you don't use first.`
          : `You can have up to ${WORKSPACE_LIMITS.perUserMax} workspaces, and one you deleted hasn't been removed from your account yet. Try again after it syncs.`,
      );
    }
    const id = context.createId();
    const now = context.now.toISOString();
    await db.workspaces.add({ id, scope, name, description: null, icon: null, color: input.color, position: 0, createdAt: now, updatedAt: now, sync: { serverVersion: null, state: "pending" }, deletedAt: null });
    await enqueueWorkspaceUpsert(db, scope, id, { name, ...(input.color !== null && { color: input.color }) }, null, context);
    return { workspaceId: id };
  });

/** Renames or recolors a workspace; only fields that actually change are queued for upload. */
export const updateWorkspace = (db: SessionHubDb, id: string, changes: { name?: string; color?: TabGroupColor | null }, context: OutboxContext): Promise<void> =>
  db.transaction("rw", [db.account, db.workspaces, db.outbox], async () => {
    const scope = await requireScope(db);
    const record = await liveWorkspace(db, scope, id);
    const changed: SyncWorkspacePayload = {};
    if (changes.name !== undefined) {
      const name = parseName(changes.name);
      if (name !== record.name) changed.name = name;
    }
    if (changes.color !== undefined && changes.color !== record.color) changed.color = changes.color;
    if (Object.keys(changed).length === 0) return;
    const state = record.sync.state === "error" ? "error" : "pending";
    await db.workspaces.put({ ...record, ...changed, updatedAt: context.now.toISOString(), sync: { ...record.sync, state } });
    await enqueueWorkspaceUpsert(db, scope, id, changed, record.sync.serverVersion, context);
  });

/**
 * Deletes a workspace (user's decision, 2026-10-17: its sessions move to "No workspace"; they are
 * not deleted). The unassignments are queued first and the delete waits for them, because the
 * account refuses to delete a workspace that still holds sessions. Until the account accepts the
 * delete the workspace stays hidden here; if it refuses (another browser added a session
 * meanwhile), the workspace comes back.
 */
export const deleteWorkspace = (db: SessionHubDb, id: string, context: OutboxContext): Promise<{ moved: number }> =>
  db.transaction("rw", [db.account, db.workspaces, db.sessions, db.outbox], async () => {
    const scope = await requireScope(db);
    const record = await liveWorkspace(db, scope, id);
    const sessions = await db.sessions.where("[scope+updatedAt]").between([scope, Dexie.minKey], [scope, Dexie.maxKey]).toArray();
    const members = sessions.filter((session) => session.workspaceId === id);
    for (const session of members) await setSessionWorkspace(db, scope, session, null, context);
    const sent = await enqueueWorkspaceDelete(db, scope, id, record.sync.serverVersion, members.map((session) => session.id), context);
    if (sent) await db.workspaces.put({ ...record, deletedAt: context.now.toISOString(), sync: { ...record.sync, state: "pending" } });
    else await db.workspaces.delete(id);
    return { moved: members.length };
  });

/** Puts an account session into a workspace (or none), with its upload queued. Sessions only in this browser can't be. */
export const assignSession = (db: SessionHubDb, sessionId: string, workspaceId: string | null, context: OutboxContext): Promise<void> =>
  db.transaction("rw", [db.account, db.workspaces, db.sessions, db.outbox], async () => {
    const scope = await requireScope(db);
    const record = await db.sessions.get(sessionId);
    if (!record || (record.scope !== scope && record.scope !== "local")) throw new SessionNotFoundError("Session no longer exists");
    if (record.scope !== scope) {
      throw new InvalidWorkspaceError("Only sessions in your account can be in a workspace. Upload this one first: Account, then Sync.");
    }
    if (workspaceId !== null) await liveWorkspace(db, scope, workspaceId);
    if (record.workspaceId === workspaceId) return;
    await setSessionWorkspace(db, scope, record, workspaceId, context);
  });
