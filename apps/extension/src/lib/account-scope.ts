import type { AccountRecord, AccountScope, LocalScope } from "./db";

export const accountScope = (accountId: string): AccountScope => `account:${accountId}`;

export const isAccountScope = (scope: LocalScope): scope is AccountScope => scope !== "local";

/**
 * Scopes visible for the stored connection (`db.account.get("connection")`): `local` always, and
 * the connected account's cached data only while connected to it and once the connection knows
 * the account id (connections saved before v4 get it at the next account check).
 *
 * Pure on purpose: callers read the connection with a direct Dexie await. Wrapping that read in
 * another async function makes liveQuery stop tracking the queries that follow it.
 */
export const visibleScopes = (connection: AccountRecord | undefined): LocalScope[] =>
  connection?.key === "connection" && connection.account.id ? ["local", accountScope(connection.account.id)] : ["local"];
