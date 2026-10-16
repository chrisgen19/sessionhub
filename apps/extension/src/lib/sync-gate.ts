import type { AccountApiError } from "./account-api";
import { accountScope } from "./account-scope";
import type { AccountDeps } from "./account-service";
import type { AccountScope, ConnectionRecord, SessionHubDb } from "./db";
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

const SIGNED_OUT = new Set(["DEVICE_REVOKED", "INVALID_TOKEN", "UNAUTHENTICATED"]);

/** Backoff after a failed request (Retry-After wins when longer). Revocation already disconnected. */
export const recordFailure = async (deps: SyncDeps, scope: AccountScope, error: AccountApiError): Promise<SyncFailure | { status: "disconnected" }> => {
  if (SIGNED_OUT.has(error.code)) return { status: "disconnected" };
  const failures = ((await deps.db.syncState.get(scope))?.failures ?? 0) + 1;
  const retryAfterMs = error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : 0;
  const retryAt = new Date(deps.now().getTime() + Math.max(retryDelayMs(failures, deps.random), retryAfterMs));
  await deps.db.syncState.update(scope, { failures, nextAttemptAt: retryAt.toISOString(), lastError: error.message });
  await deps.scheduleRetry(retryAt).catch(() => undefined);
  return { status: "error", message: error.message, retryAt: retryAt.toISOString() };
};

export const recordSuccess = async (deps: SyncDeps, scope: AccountScope): Promise<void> => {
  await deps.db.syncState.update(scope, { failures: 0, nextAttemptAt: null, lastError: null, lastSyncAt: deps.now().toISOString() });
};
