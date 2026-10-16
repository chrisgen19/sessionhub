import { Dexie } from "dexie";
import { savedSessionSchema, type SavedSession } from "@sessionhub/contracts/session";
import type { LocalScope, LocalSessionRecord, SessionHubDb } from "./db";

const SCOPE: LocalScope = "local";

const stripScope = ({ scope: _scope, ...session }: LocalSessionRecord): SavedSession => session;

/** Most recently updated first. */
export const listSessions = async (db: SessionHubDb): Promise<SavedSession[]> => {
  const records = await db.sessions
    .where("[scope+updatedAt]")
    .between([SCOPE, Dexie.minKey], [SCOPE, Dexie.maxKey])
    .reverse()
    .toArray();
  return records.map(stripScope);
};

export const getSession = async (db: SessionHubDb, id: string): Promise<SavedSession | undefined> => {
  const record = await db.sessions.get(id);
  return record && record.scope === SCOPE ? stripScope(record) : undefined;
};

/**
 * Validates and writes a session in one IndexedDB transaction. Invalid data never
 * reaches storage, so a failed save leaves earlier records untouched.
 */
export const putSession = async (db: SessionHubDb, session: SavedSession): Promise<void> => {
  const valid = savedSessionSchema.parse(session);
  await db.sessions.put({ ...valid, scope: SCOPE });
};

export class SessionExistsError extends Error {
  override name = "SessionExistsError";
}

/**
 * Inserts a new session. Unlike `putSession` this can never replace a record:
 * an existing id fails with `SessionExistsError` and nothing is written.
 */
export const addSession = async (db: SessionHubDb, session: SavedSession): Promise<void> => {
  const valid = savedSessionSchema.parse(session);
  try {
    await db.sessions.add({ ...valid, scope: SCOPE });
  } catch (error) {
    if (error instanceof Error && error.name === "ConstraintError") {
      throw new SessionExistsError("A session with this id already exists");
    }
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
 * Read-modify-write guarded by the caller's expected version, inside one transaction,
 * so a stale editor (e.g. two manager tabs) can't silently overwrite a newer edit.
 */
export const updateSession = async (
  db: SessionHubDb,
  id: string,
  expectedVersion: number,
  update: (session: SavedSession) => SavedSession,
): Promise<SavedSession> =>
  db.transaction("rw", db.sessions, async () => {
    const current = await getSession(db, id);
    if (!current) throw new SessionNotFoundError("Session no longer exists");
    if (current.version !== expectedVersion) {
      throw new VersionConflictError("Session changed elsewhere. Reload and try again.");
    }
    const next = update(current);
    if (next !== current) await putSession(db, next);
    return next;
  });

export const deleteSession = async (db: SessionHubDb, id: string): Promise<void> => {
  await db.sessions.delete(id);
};
