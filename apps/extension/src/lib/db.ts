import { Dexie, type EntityTable, type Table, type Transaction } from "dexie";
import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import type { SyncWorkspacePayload } from "@sessionhub/contracts/api-sync";
import type { SavedSession, TabGroupColor } from "@sessionhub/contracts/session";
import type { RestoreDestination, RestorePlan } from "@sessionhub/core/restore-plan";

/** Cached data of one SessionHub account (`account:<account id>`). */
export type AccountScope = `account:${string}`;

/**
 * Local data scope. `local` belongs to this browser profile, is always visible and is never
 * uploaded without the user choosing it. An account scope is visible only while this browser
 * is connected to that account (docs/DATA_MODEL.md "Account/profile isolation").
 */
export type LocalScope = "local" | AccountScope;

/**
 * Sync bookkeeping for an account-scoped session. Kept beside the session, never inside it:
 * the local `version` guards edits between extension pages, while `serverVersion` is what the
 * next upload's `expectedVersion` builds on. The two drift apart when edits are merged.
 */
export interface SessionSyncRecord {
  /** Last version the server confirmed; null until the first upload is accepted. */
  serverVersion: number | null;
  /** `conflict`: the server refused a change for a reason the user must review; `error`: it can never be uploaded as is. */
  state: "pending" | "synced" | "conflict" | "error";
}

export type LocalSessionRecord = SavedSession & {
  scope: LocalScope;
  sync?: SessionSyncRecord;
  /**
   * The account workspace it is in (account scope only; null: none). Absent until known: sessions
   * cached before v6 learn it from the next download, and their uploads leave the server's as it is.
   */
  workspaceId?: string | null;
};

/**
 * One of the connected account's workspaces (docs/SYNC_PROTOCOL.md 13j). Account scope only: sessions
 * only in this browser can't be put in a workspace. Edits upload only the fields they change.
 */
export interface LocalWorkspaceRecord {
  id: string;
  scope: AccountScope;
  name: string;
  description: string | null;
  icon: string | null;
  color: TabGroupColor | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  sync: {
    /** The server version this record's fields are based on (null until the create is accepted). */
    serverVersion: number | null;
    /** `error`: the account refused to add it, for a reason that won't go away by retrying. */
    state: "pending" | "synced" | "error";
    /** Why the account refused it (state `error`). */
    lastError?: string | null;
  };
  /** Deleted here: hidden until the account accepts the delete, shown again if it refuses. */
  deletedAt: string | null;
}

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
  /** Where the first run opened its tabs (absent on older records: new windows). Retries use new windows. */
  target?: RestoreDestination;
  /** Background tabs were unloaded after opening (retries do the same). */
  lazy?: boolean;
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
  /**
   * `id` is missing on connections saved before v4 until the next account check fills it in;
   * until then no account scope is visible (only `local` data).
   */
  account: { id?: string; name: string; email: string };
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

/**
 * One durable local change waiting for upload (docs/SYNC_PROTOCOL.md section 3), written in the
 * same transaction as the change. A `queued` operation has never been handed to the network and
 * may still be merged with a later change. The uploader must commit `sending` before the request
 * leaves; from then on the operation is immutable and never returns to `queued`, so a retry with
 * the same id always carries the same content. `conflict` and `rejected` operations stay (with the
 * payload) until the user resolves them, and hold back every later operation of the same session.
 */
export type OutboxRecord = {
  /** Auto-incremented on insert: upload order. */
  seq?: number;
  /** clientOperationId, stable across retries. */
  id: string;
  scope: AccountScope;
  entityId: string;
  /** Server version this operation applies to (0 = create). Each accepted operation adds 1. */
  expectedVersion: number;
  status: "queued" | "sending" | "conflict" | "rejected";
  createdAt: string;
  updatedAt: string;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  /** Why the server refused it (VERSION_CONFLICT, NOT_FOUND, ID_IN_USE, VALIDATION_ERROR, TOO_LARGE); absent on older records. */
  lastErrorCode?: string | null;
  /** The server version a conflict reported, so "keep mine" can build on it before the server copy arrives. */
  conflictServerVersion?: number | null;
} & (
  | { entityType: "savedSession"; action: "upsert"; payload: SessionUpload }
  | { entityType: "savedSession"; action: "delete"; payload: null }
  /** Only the fields changed here (a per-field merge); a create carries the name. */
  | { entityType: "workspace"; action: "upsert"; payload: SyncWorkspacePayload }
  /** `waitFor`: sessions moved out by this delete, whose earlier operations must be accepted first. */
  | { entityType: "workspace"; action: "delete"; payload: null; waitFor?: string[] }
);

/** What a session upload carries: the session and, once known, its workspace (absent keeps the server's). */
export type SessionUpload = SavedSession & { workspaceId?: string | null };

/**
 * A deleted account-scoped session the server may still list. Kept until the server's delete has
 * been pulled back, so a pull can't bring the session back before the delete is uploaded.
 */
export interface SessionTombstoneRecord {
  id: string;
  scope: AccountScope;
  deletedAt: string;
}

/** Per-account sync progress. Uploads run only once `enabledAt` records the user's consent. */
export interface SyncStateRecord {
  scope: AccountScope;
  /** When the user turned sync on for this account in this browser; null or absent = never upload. */
  enabledAt: string | null;
  /** Pull cursor (pull slice). */
  cursor: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  /** API error code of `lastError` (NETWORK means offline); absent on older records. */
  lastErrorCode?: string | null;
  /** Consecutive failed uploads, for backoff. */
  failures: number;
  /** No automatic upload before this time (backoff or Retry-After). */
  nextAttemptAt: string | null;
  /**
   * A full rebuild in progress (no cursor, or the server said CURSOR_EXPIRED): the first page's
   * cursor, which pulling resumes from afterwards, and where the next page starts.
   */
  bootstrap?: { cursor: string; after: string | null } | null;
}

/**
 * The newest server state of a session that has local changes waiting. Pull never overwrites
 * those, so it holds the server's state here: applied once the local changes are accepted (if it
 * is newer), or kept for review if they conflict.
 */
export interface ServerCopyRecord {
  id: string;
  scope: AccountScope;
  action: "upsert" | "delete";
  version: number;
  payload: ApiSessionDetail | null;
  receivedAt: string;
}

export type SessionHubDb = Dexie & {
  sessions: EntityTable<LocalSessionRecord, "id">;
  device: EntityTable<DeviceRecord, "key">;
  restoreJobs: EntityTable<RestoreJobRecord, "id">;
  recoverySnapshots: EntityTable<RecoverySnapshotRecord, "id">;
  recoveryState: EntityTable<RecoveryStateRecord, "key">;
  account: Table<AccountRecord, AccountRecord["key"]>;
  outbox: Table<OutboxRecord, number>;
  sessionTombstones: EntityTable<SessionTombstoneRecord, "id">;
  syncState: EntityTable<SyncStateRecord, "scope">;
  serverCopies: EntityTable<ServerCopyRecord, "id">;
  workspaces: EntityTable<LocalWorkspaceRecord, "id">;
};

export const DB_NAME = "sessionhub";

/** Makes every account download a full copy (bootstrap) on its next sync. */
const rebuildAccounts = (tx: Transaction) =>
  tx
    .table<SyncStateRecord, AccountScope>("syncState")
    .toCollection()
    .modify((state) => {
      state.cursor = null;
      state.bootstrap = null;
    });

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
  // v4: account scope + sync outbox. Additive only; existing sessions stay `local`.
  db.version(4).stores({
    outbox: "++seq, &id, [scope+seq], entityId",
    sessionTombstones: "id, scope",
    syncState: "scope",
  });
  // v5: server copies held while local changes wait (pull). Additive only.
  db.version(5).stores({ serverCopies: "id, scope" });
  // v6: account workspaces. Every account rebuilds once from a full copy (bootstrap), because
  // earlier downloads skipped workspaces and sessions' workspace assignments.
  db.version(6).stores({ workspaces: "id, scope" }).upgrade(rebuildAccounts);
  // v7: notes, tags, pinned and archived on sessions (no new index). Every account rebuilds once more,
  // so cached sessions learn what was set on the website before this browser stored these fields.
  db.version(7).stores({}).upgrade(rebuildAccounts);
  return db;
};

let shared: SessionHubDb | undefined;

/** Lazily-created per-context database handle. Safe to recreate after worker restarts. */
export const getDb = (): SessionHubDb => {
  shared ??= createDb();
  return shared;
};
