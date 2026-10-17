import { activeAccountScope } from "./account-scope";
import type { AccountScope, SessionHubDb } from "./db";
import { enqueueSessionUpsert, type OutboxContext } from "./outbox-repository";

export class SyncUnavailableError extends Error {
  override name = "SyncUnavailableError";
}

const connectedScope = async (db: SessionHubDb): Promise<AccountScope> => {
  const scope = activeAccountScope(await db.account.get("connection"));
  if (!scope) throw new SyncUnavailableError("Connect this browser to your account first. Open Account and check the connection.");
  return scope;
};

/**
 * Turns sync on for the connected account in this browser: records the user's consent
 * (`enabledAt`, kept from the first time) and moves the sessions they chose into the account's
 * scope with queued creates, all in one transaction (user's decision: move, not copy). Only this
 * browser's own sessions move; anything else in the list is skipped. Re-enabling keeps the cursor.
 */
export const enableSync = (db: SessionHubDb, sessionIds: string[], context: OutboxContext): Promise<{ enabledAt: string; moved: number }> =>
  db.transaction("rw", [db.account, db.syncState, db.sessions, db.outbox], async () => {
    const scope = await connectedScope(db);
    const state = await db.syncState.get(scope);
    const enabledAt = state?.enabledAt ?? context.now.toISOString();
    await db.syncState.put({
      scope,
      enabledAt,
      cursor: state?.cursor ?? null,
      bootstrap: state?.bootstrap ?? null,
      lastSyncAt: state?.lastSyncAt ?? null,
      lastError: null,
      lastErrorCode: null,
      failures: 0,
      nextAttemptAt: null,
    });
    let moved = 0;
    for (const id of new Set(sessionIds)) {
      const record = await db.sessions.get(id);
      if (!record || record.scope !== "local") continue;
      const { scope: _scope, sync: _sync, ...session } = record;
      await db.sessions.put({ ...session, scope, sync: { serverVersion: null, state: "pending" } });
      await enqueueSessionUpsert(db, scope, session, null, context);
      moved += 1;
    }
    return { enabledAt, moved };
  });

/**
 * Turns sync off for the connected account in this browser. Nothing is deleted: the account's
 * sessions stay here (shown as "Sync off"), queued changes wait, and new saves stay local.
 */
export const disableSync = (db: SessionHubDb): Promise<void> =>
  db.transaction("rw", [db.account, db.syncState], async () => {
    const scope = await connectedScope(db);
    await db.syncState.update(scope, { enabledAt: null });
  });
