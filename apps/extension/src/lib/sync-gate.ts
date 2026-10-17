import { AccountApiError } from "./account-api";
import { accountScope } from "./account-scope";
import { withAccessToken, type AccountDeps } from "./account-service";
import type { AccountRecord, AccountScope, ConnectionRecord, SessionHubDb } from "./db";
import { retryDelayMs } from "./sync-batch";

export interface SyncDeps {
  db: SessionHubDb;
  now: () => Date;
  random: () => number;
  /** Authenticated network access (token refresh, revocation handling). */
  account: AccountDeps;
  /** Arms the retry alarm; sync runs again at or after this time. */
  scheduleRetry: (at: Date) => Promise<void>;
}

export type GateClosed = { status: "disconnected" } | { status: "disabled" } | { status: "waiting"; retryAt: string };
export type SyncFailure = { status: "error"; message: string; retryAt: string | null };

/**
 * Who a sync run is for: the connected account (its id known), only once the user turned sync on
 * for it in this browser (`enabledAt`, the local consent), and not before the backoff time unless
 * forced (Sync now).
 */
export const openSync = async (deps: SyncDeps, force: boolean): Promise<{ connection: ConnectionRecord; scope: AccountScope } | GateClosed> => {
  const connection = (await deps.db.account.get("connection")) as ConnectionRecord | undefined;
  if (!connection?.account.id) return { status: "disconnected" };
  const scope = accountScope(connection.account.id);
  const state = await deps.db.syncState.get(scope);
  if (!state?.enabledAt) return { status: "disabled" };
  if (!force && state.nextAttemptAt && new Date(state.nextAttemptAt) > deps.now()) return { status: "waiting", retryAt: state.nextAttemptAt };
  return { connection, scope };
};

/** Whether `connection` is still the account that this run's `scope` belongs to. */
export const isRunAccount = (connection: AccountRecord | undefined, scope: AccountScope): boolean =>
  connection?.key === "connection" && !!connection.account.id && accountScope(connection.account.id) === scope;

/**
 * An authenticated request for this run's account only. Every request rereads the connection,
 * so if another account was connected since the run opened, the run ends here (as disconnected)
 * instead of fetching into, or uploading from, this scope with that account's token.
 */
export const withRunToken = <T>(deps: SyncDeps, scope: AccountScope, call: (accessToken: string, apiOrigin: string) => Promise<T>): Promise<T> =>
  withAccessToken(deps.account, async (token, origin, connection) => {
    if (!isRunAccount(connection, scope)) throw new AccountApiError("UNAUTHENTICATED", "A different account was connected during sync.");
    return call(token, origin);
  });

/**
 * Checked again before every request of a run: turning sync off, disconnecting or connecting
 * another account stops the run at its next round or page. A request already sent can't be recalled.
 */
export const stillOpen = async (db: SessionHubDb, scope: AccountScope): Promise<GateClosed | null> => {
  if (!isRunAccount(await db.account.get("connection"), scope)) return { status: "disconnected" };
  return (await db.syncState.get(scope))?.enabledAt ? null : { status: "disabled" };
};

const SIGNED_OUT = new Set(["DEVICE_REVOKED", "INVALID_TOKEN", "UNAUTHENTICATED"]);

/** Backoff after a failed request (Retry-After wins when longer). Revocation already disconnected. */
export const recordFailure = async (deps: SyncDeps, scope: AccountScope, error: AccountApiError): Promise<SyncFailure | { status: "disconnected" }> => {
  if (SIGNED_OUT.has(error.code)) return { status: "disconnected" };
  const failures = ((await deps.db.syncState.get(scope))?.failures ?? 0) + 1;
  const retryAfterMs = error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : 0;
  const retryAt = new Date(deps.now().getTime() + Math.max(retryDelayMs(failures, deps.random), retryAfterMs));
  await deps.db.syncState.update(scope, { failures, nextAttemptAt: retryAt.toISOString(), lastError: error.message, lastErrorCode: error.code });
  await deps.scheduleRetry(retryAt).catch(() => undefined);
  return { status: "error", message: error.message, retryAt: retryAt.toISOString() };
};

/**
 * A completed run, upload then download: "Last synced" moves and the backoff resets. Only the
 * download records it, so a failed download after a good upload keeps backing off.
 */
export const recordSuccess = async (deps: SyncDeps, scope: AccountScope): Promise<void> => {
  await deps.db.syncState.update(scope, { failures: 0, nextAttemptAt: null, lastError: null, lastErrorCode: null, lastSyncAt: deps.now().toISOString() });
};
