import { Dexie } from "dexie";
import { savedSessionSchema, type SavedSession } from "@sessionhub/contracts/session";
import { activeAccountScope, isAccountScope, visibleScopes } from "./account-scope";
import type { LocalScope, LocalSessionRecord, SessionHubDb } from "./db";
import { enqueueSessionDelete, enqueueSessionUpsert, type OutboxContext } from "./outbox-repository";
import { sessionSyncLabel, type SessionSyncLabel } from "./sync-status";

const stripLocalFields = ({ scope: _scope, sync: _sync, ...session }: LocalSessionRecord): SavedSession => session;

const scopeRecords = (db: SessionHubDb, scope: LocalScope): Promise<LocalSessionRecord[]> =>
  db.sessions.where("[scope+updatedAt]").between([scope, Dexie.minKey], [scope, Dexie.maxKey]).reverse().toArray();

/**
 * Visible sessions plus each one's sync label, for lists. Same liveQuery rules as below: direct
 * Dexie awaits only (connection, then each scope, then the account's sync state).
 */
export const listSessionsWithSync = async (db: SessionHubDb): Promise<{ sessions: SavedSession[]; syncLabels: Record<string, SessionSyncLabel> }> => {
  const connection = await db.account.get("connection");
  const records: LocalSessionRecord[] = [];
  for (const scope of visibleScopes(connection)) records.push(...(await scopeRecords(db, scope)));
  const active = activeAccountScope(connection);
  const syncEnabled = Boolean(active && (await db.syncState.get(active))?.enabledAt);
  records.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return {
    sessions: records.map(stripLocalFields),
    syncLabels: Object.fromEntries(records.map((record) => [record.id, sessionSyncLabel(record, syncEnabled)])),
  };
};

/**
 * Visible sessions (this browser's and the connected account's), most recently updated first.
 * Runs inside liveQuery, which only tracks queries reached through direct awaits of Dexie
 * promises: no Promise.all and no nested async helpers here, or lists stop updating.
 */
export const listSessions = async (db: SessionHubDb): Promise<SavedSession[]> => {
  const scopes = visibleScopes(await db.account.get("connection"));
  const records: LocalSessionRecord[] = [];
  for (const scope of scopes) records.push(...(await scopeRecords(db, scope)));
  // Stable sort: each scope's list is already newest first.
  return records.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).map(stripLocalFields);
};

/**
 * The record if it exists in a visible scope; another account's cached session reads as missing.
 * A chain of Dexie promises (not an async function) for the same liveQuery reason as above.
 */
const getVisibleRecord = (db: SessionHubDb, id: string) =>
  db.account.get("connection").then((connection) =>
    db.sessions.get(id).then((record) => (record && visibleScopes(connection).includes(record.scope) ? record : undefined)),
  );

export const getSession = async (db: SessionHubDb, id: string): Promise<SavedSession | undefined> => {
  const record = await getVisibleRecord(db, id);
  return record && stripLocalFields(record);
};

/**
 * Validates and writes a session of this browser (`local` scope) in one IndexedDB transaction.
 * Invalid data never reaches storage, so a failed save leaves earlier records untouched.
 */
export const putSession = async (db: SessionHubDb, session: SavedSession): Promise<void> => {
  const valid = savedSessionSchema.parse(session);
  await db.sessions.put({ ...valid, scope: "local" });
};

export class SessionExistsError extends Error {
  override name = "SessionExistsError";
}

/**
 * Inserts a new session of this browser. Unlike `putSession` this can never replace a record:
 * an existing id fails with `SessionExistsError` and nothing is written.
 */
export const addSession = async (db: SessionHubDb, session: SavedSession): Promise<void> => {
  const valid = savedSessionSchema.parse(session);
  try {
    await db.sessions.add({ ...valid, scope: "local" });
  } catch (error) {
    if (error instanceof Error && error.name === "ConstraintError") {
      throw new SessionExistsError("A session with this id already exists");
    }
    throw error;
  }
};

/** Where a new save goes: the connected account once sync is on for it (docs/USER_FLOWS.md Flow 2), else this browser. */
const newSessionScope = (db: SessionHubDb): Promise<LocalScope> =>
  db.account.get("connection").then((connection) => {
    const scope = activeAccountScope(connection);
    return scope ? db.syncState.get(scope).then((state): LocalScope => (state?.enabledAt ? scope : "local")) : "local";
  });

/**
 * Saves a new session (capture or import) where new saves belong, with its upload queued in the
 * same transaction when that is the account. `replace: false` refuses an existing id.
 */
export const saveNewSession = async (db: SessionHubDb, session: SavedSession, context: OutboxContext, { replace = false } = {}): Promise<LocalScope> => {
  const valid = savedSessionSchema.parse(session);
  try {
    return await db.transaction("rw", [db.sessions, db.outbox, db.account, db.syncState], async () => {
      const scope = await newSessionScope(db);
      const record: LocalSessionRecord = isAccountScope(scope) ? { ...valid, scope, sync: { serverVersion: null, state: "pending" } } : { ...valid, scope };
      await (replace ? db.sessions.put(record) : db.sessions.add(record));
      if (isAccountScope(scope)) await enqueueSessionUpsert(db, scope, valid, null, context);
      return scope;
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ConstraintError") throw new SessionExistsError("A session with this id already exists");
    throw error;
  }
};

export class VersionConflictError extends Error {
  override name = "VersionConflictError";
}

export class SessionNotFoundError extends Error {
  override name = "SessionNotFoundError";
}

/**
 * Read-modify-write guarded by the caller's expected version, inside one transaction, so a stale
 * editor (e.g. two manager tabs) can't silently overwrite a newer edit. Editing an account's
 * session also queues its upload in the same transaction: both are written or neither is.
 */
export const updateSession = async (
  db: SessionHubDb,
  id: string,
  expectedVersion: number,
  update: (session: SavedSession) => SavedSession,
  context: OutboxContext,
): Promise<SavedSession> =>
  db.transaction("rw", [db.sessions, db.outbox, db.account], async () => {
    const record = await getVisibleRecord(db, id);
    if (!record) throw new SessionNotFoundError("Session no longer exists");
    const current = stripLocalFields(record);
    if (current.version !== expectedVersion) {
      throw new VersionConflictError("Session changed elsewhere. Reload and try again.");
    }
    const next = update(current);
    if (next === current) return current;
    const valid = savedSessionSchema.parse(next);
    if (!isAccountScope(record.scope)) {
      await db.sessions.put({ ...valid, scope: record.scope });
      return valid;
    }
    const serverVersion = record.sync?.serverVersion ?? null;
    await enqueueSessionUpsert(db, record.scope, valid, serverVersion, context);
    // An unresolved conflict stays visible until the user resolves it.
    const state = record.sync?.state === "conflict" ? "conflict" : "pending";
    await db.sessions.put({ ...valid, scope: record.scope, sync: { serverVersion, state } });
    return valid;
  });

/**
 * Deletes a visible session; a missing or hidden one is left alone, so repeating is harmless.
 * This browser's sessions are removed outright. An account's session is also queued for deletion
 * on the server and leaves a tombstone, all in one transaction.
 */
export const deleteSession = async (db: SessionHubDb, id: string, context: OutboxContext): Promise<void> =>
  db.transaction("rw", [db.sessions, db.outbox, db.sessionTombstones, db.account], async () => {
    const record = await getVisibleRecord(db, id);
    if (!record) return;
    if (isAccountScope(record.scope)) {
      const serverMayKnow = await enqueueSessionDelete(db, record.scope, id, record.sync?.serverVersion ?? null, context);
      if (serverMayKnow) await db.sessionTombstones.put({ id, scope: record.scope, deletedAt: context.now.toISOString() });
    }
    await db.sessions.delete(id);
  });
