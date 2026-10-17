import { Dexie } from "dexie";
import { activeAccountScope } from "./account-scope";
import type { SessionHubDb } from "./db";
import { syncOverview, type SyncOverview } from "./sync-status";

/** Reads the overall sync state for the status chip and Account view (direct Dexie awaits, for liveQuery). */
export const readSyncOverview = async (db: SessionHubDb): Promise<SyncOverview> => {
  const scope = activeAccountScope(await db.account.get("connection"));
  if (!scope) return syncOverview({ connected: false, state: undefined, operations: [], localSessions: 0 });
  const state = await db.syncState.get(scope);
  const operations = await db.outbox.where("[scope+seq]").between([scope, Dexie.minKey], [scope, Dexie.maxKey]).toArray();
  const localSessions = await db.sessions.where("[scope+updatedAt]").between(["local", Dexie.minKey], ["local", Dexie.maxKey]).count();
  return syncOverview({ connected: true, state, operations, localSessions });
};
