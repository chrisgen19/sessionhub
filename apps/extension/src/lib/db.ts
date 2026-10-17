import { Dexie, type EntityTable } from "dexie";
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

export type SessionHubDb = Dexie & {
  sessions: EntityTable<LocalSessionRecord, "id">;
  device: EntityTable<DeviceRecord, "key">;
  restoreJobs: EntityTable<RestoreJobRecord, "id">;
  recoverySnapshots: EntityTable<RecoverySnapshotRecord, "id">;
  recoveryState: EntityTable<RecoveryStateRecord, "key">;
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
  return db;
};

let shared: SessionHubDb | undefined;

/** Lazily-created per-context database handle. Safe to recreate after worker restarts. */
export const getDb = (): SessionHubDb => {
  shared ??= createDb();
  return shared;
};
