import { Dexie, type EntityTable, type Table } from "dexie";
import type { SavedSession } from "@sessionhub/contracts/session";
import type { RestorePlan } from "@sessionhub/core/restore-plan";

/**
 * Local data scope. Everything is `local` until cloud accounts exist (M4); records are
 * scoped from day one so account isolation won't need a destructive migration.
 */
export type LocalScope = "local";

export type LocalSessionRecord = SavedSession & { scope: LocalScope };

export interface DeviceRecord {
  key: "this-device";
  installationId: string;
  friendlyName: string;
  createdAt: string;
}

export type RestoreTabOutcome = { sourceTabId: string } & (
  | { status: "opened" }
  | { status: "failed"; error: string }
);

export interface RestoreJobRecord {
  id: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  status: "running" | "completed" | "partial" | "failed";
  plan: RestorePlan;
  /** Append-only across attempts; a tab can have a failed outcome followed by an opened one. */
  outcomes: RestoreTabOutcome[];
  /** Number of runs (1 = first restore). Absent on records written before retry existed. */
  attempts?: number;
  /** Set when a later worker found this job still `running` and settled it (the run was cut off). */
  interruptedAt?: string;
}

/**
 * Automatic, immutable, local-only checkpoint of this browser's normal windows.
 * `session` reuses the saved-session shape (its id equals the snapshot id) so the
 * window tree, restore planner and export work unchanged. Never synced.
 */
export interface RecoverySnapshotRecord {
  id: string;
  capturedAt: string;
  reason: "automatic" | "manual";
  fingerprint: string;
  windowCount: number;
  tabCount: number;
  session: SavedSession;
}

/** Durable dirty flag. Worker globals are only an optimization, never the source of truth. */
export interface RecoveryStateRecord {
  key: "state";
  dirty: boolean;
  /** Time of the most recent browser change event. */
  lastChangeAt: string | null;
  lastSnapshotAt: string | null;
  lastFingerprint: string | null;
  lastError: string | null;
}

/** A pairing started in this browser and not yet approved (expires after 10 minutes). */
export interface PendingPairingRecord {
  key: "pairing";
  apiOrigin: string;
  /** Secret; sent only to the SessionHub server to redeem the pairing. */
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  interval: number;
  startedAt: string;
  expiresAt: string;
}

/**
 * This browser's connection to a SessionHub account. Tokens live only here (extension-origin
 * IndexedDB, unreachable from web pages: there are no content scripts) and are never exported.
 */
export interface ConnectionRecord {
  key: "connection";
  apiOrigin: string;
  deviceId: string;
  deviceName: string;
  account: { name: string; email: string };
  connectedAt: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

/** Why the last connection ended without the user asking (shown once in the Account view). */
export interface ConnectionNoticeRecord {
  key: "notice";
  reason: "revoked" | "expired";
  at: string;
}

export type AccountRecord = PendingPairingRecord | ConnectionRecord | ConnectionNoticeRecord;

export type SessionHubDb = Dexie & {
  sessions: EntityTable<LocalSessionRecord, "id">;
  device: EntityTable<DeviceRecord, "key">;
  restoreJobs: EntityTable<RestoreJobRecord, "id">;
  recoverySnapshots: EntityTable<RecoverySnapshotRecord, "id">;
  recoveryState: EntityTable<RecoveryStateRecord, "key">;
  account: Table<AccountRecord, AccountRecord["key"]>;
};

export const DB_NAME = "sessionhub";

/** Opens the local database. Schema changes must add a new version, never edit an old one. */
export const createDb = (name: string = DB_NAME): SessionHubDb => {
  const db = new Dexie(name) as SessionHubDb;
  db.version(1).stores({
    sessions: "id, [scope+updatedAt]",
    device: "key",
    restoreJobs: "id, sessionId, createdAt",
  });
  // v2: recovery checkpoints. Additive only; v1 tables are untouched.
  db.version(2).stores({
    recoverySnapshots: "id, capturedAt, [capturedAt+tabCount]",
    recoveryState: "key",
  });
  // v3: account connection (pairing, device credentials). Additive only.
  db.version(3).stores({ account: "key" });
  return db;
};

let shared: SessionHubDb | undefined;

/** Lazily-created per-context database handle. Safe to recreate after worker restarts. */
export const getDb = (): SessionHubDb => {
  shared ??= createDb();
  return shared;
};
