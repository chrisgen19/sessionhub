import type { DeviceCredentials } from "@sessionhub/contracts/api-pairing";
import { AccountApiError, disconnectSelf, fetchMe, pollPairingToken, refreshTokens, requestPairing, type Fetch } from "./account-api";
import type { ConnectionNoticeRecord, ConnectionRecord, PendingPairingRecord, SessionHubDb } from "./db";
import { getOrCreateDevice } from "./device-repository";

export interface AccountDeps {
  db: SessionHubDb;
  fetch: Fetch;
  now: () => Date;
  createId: () => string;
  apiOrigin: string;
  /** Opens the approve page in a normal tab next to the current one. */
  openTab: (url: string) => Promise<void>;
  /** Chrome's OS name (runtime.getPlatformInfo().os), used for the default device name. */
  platformOs: () => Promise<string>;
}

export type AccountStatus =
  | { kind: "disconnected"; notice: ConnectionNoticeRecord["reason"] | null }
  | { kind: "pairing"; userCode: string; verificationUriComplete: string; expiresAt: string; interval: number }
  | { kind: "connected"; account: { name: string; email: string }; deviceName: string; connectedAt: string; apiOrigin: string };

export type PairingOutcome = "waiting" | "connected" | "denied" | "expired";

/** Refresh this long before the server's expiry, to absorb clock skew and slow networks. */
const REFRESH_MARGIN_MS = 60_000;

const OS_NAMES: Record<string, string> = { win: "Windows", mac: "macOS", linux: "Linux", cros: "ChromeOS", android: "Android", openbsd: "OpenBSD", fuchsia: "Fuchsia" };

const toStatus = (record: ConnectionRecord): AccountStatus => ({
  kind: "connected",
  account: record.account,
  deviceName: record.deviceName,
  connectedAt: record.connectedAt,
  apiOrigin: record.apiOrigin,
});

export const getAccountStatus = async ({ db, now }: Pick<AccountDeps, "db" | "now">): Promise<AccountStatus> => {
  const records = await db.account.toArray();
  const connection = records.find((record): record is ConnectionRecord => record.key === "connection");
  if (connection) return toStatus(connection);
  const pairing = records.find((record): record is PendingPairingRecord => record.key === "pairing");
  if (pairing && new Date(pairing.expiresAt) > now()) {
    return { kind: "pairing", userCode: pairing.userCode, verificationUriComplete: pairing.verificationUriComplete, expiresAt: pairing.expiresAt, interval: pairing.interval };
  }
  if (pairing) await db.account.delete("pairing");
  const notice = records.find((record): record is ConnectionNoticeRecord => record.key === "notice");
  return { kind: "disconnected", notice: notice?.reason ?? null };
};

/** Asks the server for a pairing code and opens the approve page. Sends no session data. */
export const startPairing = async (deps: AccountDeps): Promise<AccountStatus> => {
  if ((await getAccountStatus(deps)).kind === "connected") throw new AccountApiError("VALIDATION_ERROR", "This browser is already connected. Disconnect it first.");
  const device = await getOrCreateDevice(deps.db, deps.createId, deps.now());
  const os = OS_NAMES[await deps.platformOs().catch(() => "")] ?? null;
  const response = await requestPairing(deps.fetch, deps.apiOrigin, {
    installationId: device.installationId,
    deviceName: os ? `Chrome on ${os}` : "Chrome",
    browser: "Chrome",
    platform: os,
  });
  const startedAt = deps.now();
  await deps.db.transaction("rw", deps.db.account, async () => {
    await deps.db.account.delete("notice");
    await deps.db.account.put({
      key: "pairing",
      apiOrigin: deps.apiOrigin,
      deviceCode: response.deviceCode,
      userCode: response.userCode,
      verificationUriComplete: response.verificationUriComplete,
      interval: response.interval,
      startedAt: startedAt.toISOString(),
      expiresAt: new Date(startedAt.getTime() + response.expiresIn * 1000).toISOString(),
    });
  });
  await deps.openTab(response.verificationUriComplete);
  return getAccountStatus(deps);
};

/** One poll of the pending pairing. Stores the credentials when the website approved it. */
export const pollPairing = async (deps: AccountDeps): Promise<{ outcome: PairingOutcome; status: AccountStatus }> => {
  const pairing = (await deps.db.account.get("pairing")) as PendingPairingRecord | undefined;
  if (!pairing || new Date(pairing.expiresAt) <= deps.now()) {
    await deps.db.account.delete("pairing");
    return { outcome: "expired", status: await getAccountStatus(deps) };
  }
  try {
    const result = await pollPairingToken(deps.fetch, pairing.apiOrigin, pairing.deviceCode);
    if (result.status === "pending") return { outcome: "waiting", status: await getAccountStatus(deps) };
    await saveConnection(deps, pairing.apiOrigin, result.device.id, result.device.displayName, result.account, result.credentials);
    return { outcome: "connected", status: await getAccountStatus(deps) };
  } catch (error) {
    if (error instanceof AccountApiError && (error.code === "PAIRING_DENIED" || error.code === "PAIRING_EXPIRED")) {
      await deps.db.account.delete("pairing");
      return { outcome: error.code === "PAIRING_DENIED" ? "denied" : "expired", status: await getAccountStatus(deps) };
    }
    // Polled a little early, or a network blip: keep waiting.
    if (error instanceof AccountApiError && (error.code === "RATE_LIMITED" || error.code === "NETWORK")) {
      return { outcome: "waiting", status: await getAccountStatus(deps) };
    }
    throw error;
  }
};

export const cancelPairing = async (deps: AccountDeps): Promise<AccountStatus> => {
  await deps.db.account.delete("pairing");
  return getAccountStatus(deps);
};

const saveConnection = (
  deps: AccountDeps,
  apiOrigin: string,
  deviceId: string,
  deviceName: string,
  account: { name: string; email: string },
  credentials: DeviceCredentials,
) =>
  deps.db.transaction("rw", deps.db.account, async () => {
    await deps.db.account.bulkDelete(["pairing", "notice"]);
    await deps.db.account.put({ key: "connection", apiOrigin, deviceId, deviceName, account, connectedAt: deps.now().toISOString(), ...credentials });
  });

/** Ends the connection locally (local sessions stay) and remembers why, for the Account view. */
const markDisconnected = (deps: AccountDeps, reason: ConnectionNoticeRecord["reason"]) =>
  deps.db.transaction("rw", deps.db.account, async () => {
    await deps.db.account.delete("connection");
    await deps.db.account.put({ key: "notice", reason, at: deps.now().toISOString() });
  });

let refreshing: Promise<ConnectionRecord> | null = null;

/**
 * Rotates the tokens. Only one refresh runs at a time in this worker: two concurrent
 * refreshes with the same token would look like theft to the server and revoke the device.
 */
const refreshConnection = (deps: AccountDeps, connection: ConnectionRecord): Promise<ConnectionRecord> => {
  refreshing ??= (async () => {
    try {
      const credentials = await refreshTokens(deps.fetch, connection.apiOrigin, connection.refreshToken);
      const next = { ...connection, ...credentials };
      await deps.db.account.put(next);
      return next;
    } catch (error) {
      if (error instanceof AccountApiError && (error.code === "DEVICE_REVOKED" || error.code === "INVALID_TOKEN")) {
        await markDisconnected(deps, error.code === "DEVICE_REVOKED" ? "revoked" : "expired");
      }
      throw error;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
};

/**
 * Runs an authenticated call with a valid access token: refreshes ahead of expiry, and once
 * more if the server still says the token expired (clock skew). Revocation disconnects.
 */
export const withAccessToken = async <T>(deps: AccountDeps, call: (accessToken: string, apiOrigin: string) => Promise<T>): Promise<T> => {
  let connection = (await deps.db.account.get("connection")) as ConnectionRecord | undefined;
  if (!connection) throw new AccountApiError("UNAUTHENTICATED", "This browser isn't connected to an account.");
  if (new Date(connection.accessExpiresAt).getTime() - REFRESH_MARGIN_MS <= deps.now().getTime()) connection = await refreshConnection(deps, connection);
  try {
    return await call(connection.accessToken, connection.apiOrigin);
  } catch (error) {
    if (!(error instanceof AccountApiError)) throw error;
    if (error.code === "ACCESS_TOKEN_EXPIRED") return call((await refreshConnection(deps, connection)).accessToken, connection.apiOrigin);
    if (error.code === "DEVICE_REVOKED" || error.code === "INVALID_TOKEN") await markDisconnected(deps, error.code === "DEVICE_REVOKED" ? "revoked" : "expired");
    throw error;
  }
};

/** Confirms the connection with the server and refreshes the shown account details. */
export const checkConnection = async (deps: AccountDeps): Promise<AccountStatus> => {
  try {
    const me = await withAccessToken(deps, (token, origin) => fetchMe(deps.fetch, origin, token));
    const connection = (await deps.db.account.get("connection")) as ConnectionRecord | undefined;
    if (connection) await deps.db.account.put({ ...connection, account: me.account, deviceName: me.device.displayName });
  } catch (error) {
    // Offline or server trouble: keep showing the stored connection.
    if (!(error instanceof AccountApiError) || !["DEVICE_REVOKED", "INVALID_TOKEN", "UNAUTHENTICATED"].includes(error.code)) {
      return getAccountStatus(deps);
    }
  }
  return getAccountStatus(deps);
};

/** Revokes this device on the server (best effort) and forgets the credentials. Local data stays. */
export const disconnect = async (deps: AccountDeps): Promise<AccountStatus> => {
  await withAccessToken(deps, (token, origin) => disconnectSelf(deps.fetch, origin, token)).catch(() => undefined);
  await deps.db.account.bulkDelete(["connection", "notice", "pairing"]);
  return getAccountStatus(deps);
};
