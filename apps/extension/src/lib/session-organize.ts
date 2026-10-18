import { addTag, duplicateSession, editSessionDetails, InvalidSessionDetailsError, removeTag, type SessionDetails } from "@sessionhub/core/session-organize";
import { isAccountScope } from "./account-scope";
import type { SessionHubDb } from "./db";
import type { OutboxContext } from "./outbox-repository";
import { deleteSession, getSession, getSessionScope, saveNewSession, SessionNotFoundError, updateSession } from "./session-repository";
import { assignSession } from "./workspace-repository";

/**
 * Organizing saved sessions from the manager (docs/UI_UX_DESIGN.md 18p). Every change goes through
 * the same repository calls as a single edit, so an account's session queues its upload with it.
 */

/** Changes a session's notes, tags, pinned or archived, guarded by the editor's version. */
export const editDetails = (db: SessionHubDb, id: string, expectedVersion: number, patch: Partial<SessionDetails>, context: OutboxContext) =>
  updateSession(db, id, expectedVersion, (session) => editSessionDetails(session, patch, context.now), context);

/** Saves a copy as a new session, where new saves go (the account once sync is on). */
export const duplicate = async (db: SessionHubDb, id: string, context: OutboxContext): Promise<{ sessionId: string; syncing: boolean }> => {
  const session = await getSession(db, id);
  if (!session) throw new SessionNotFoundError("Session no longer exists");
  const copy = duplicateSession(session, context);
  const scope = await saveNewSession(db, copy, context);
  return { sessionId: copy.id, syncing: scope !== "local" };
};

export type BulkAction =
  | { kind: "delete" }
  | { kind: "archive"; archived: boolean }
  | { kind: "tag"; tag: string; add: boolean }
  | { kind: "assign"; workspaceId: string | null };

export interface BulkResult {
  /** Sessions that changed (already as asked: not counted). */
  changed: number;
  /** Sessions only in this browser, which can't be in a workspace. */
  notInAccount: number;
  /** Sessions that already have the most tags allowed. */
  tooManyTags: number;
}

/**
 * Applies one action to several sessions in one transaction: all of it is stored, or none. Missing
 * sessions are passed over. Sessions an action can't apply to are counted, not refused, so the rest
 * still change.
 */
export const bulkEdit = (db: SessionHubDb, ids: readonly string[], action: BulkAction, context: OutboxContext): Promise<BulkResult> =>
  db.transaction("rw", [db.sessions, db.outbox, db.account, db.sessionTombstones, db.workspaces], async () => {
    const result: BulkResult = { changed: 0, notInAccount: 0, tooManyTags: 0 };
    for (const id of new Set(ids)) {
      const session = await getSession(db, id);
      if (!session) continue;
      if (action.kind === "delete") {
        await deleteSession(db, id, context);
        result.changed += 1;
        continue;
      }
      if (action.kind === "assign") {
        const scope = await getSessionScope(db, id);
        if (!scope || !isAccountScope(scope)) result.notInAccount += 1;
        else {
          await assignSession(db, id, action.workspaceId, context);
          result.changed += 1;
        }
        continue;
      }
      const change = (current: typeof session) =>
        action.kind === "archive"
          ? editSessionDetails(current, { isArchived: action.archived }, context.now)
          : action.add
            ? addTag(current, action.tag, context.now)
            : removeTag(current, action.tag, context.now);
      // Checked before writing: a failed change inside the transaction would undo the others.
      try {
        if (change(session) === session) continue;
      } catch (error) {
        if (!(error instanceof InvalidSessionDetailsError) || action.kind !== "tag" || !action.add) throw error;
        result.tooManyTags += 1;
        continue;
      }
      await updateSession(db, id, session.version, change, context);
      result.changed += 1;
    }
    return result;
  });
