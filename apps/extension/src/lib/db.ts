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
}

export type SessionHubDb = Dexie & {
  sessions: EntityTable<LocalSessionRecord, "id">;
  device: EntityTable<DeviceRecord, "key">;
  restoreJobs: EntityTable<RestoreJobRecord, "id">;
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
  return db;
};

let shared: SessionHubDb | undefined;

/** Lazily-created per-context database handle. Safe to recreate after worker restarts. */
export const getDb = (): SessionHubDb => {
  shared ??= createDb();
  return shared;
};
