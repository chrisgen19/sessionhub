import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import { SESSION_SCHEMA_VERSION, type SavedSession } from "@sessionhub/contracts/session";

/**
 * Pure rules for applying the server's canonical changes to a device's local cache
 * (docs/SYNC_PROTOCOL.md sections 3, 7, 11 and 13e). The extension reads the local state,
 * asks these functions what to do and performs it inside one IndexedDB transaction per page.
 */

/** What the device knows locally about one session, read inside the page's transaction. */
export interface LocalEntity {
  /** Scope of the local record with this id, wherever it is; null when there is none. */
  recordScope: string | null;
  /** Last server version this device stored for it (null: never confirmed by the server). */
  serverVersion: number | null;
  /** Outbox operations for it in the target scope, in any status (queued, sending, conflict, rejected). */
  pendingOperations: number;
  /** A local delete waiting for the server's delete to come back. */
  tombstone: boolean;
  /** Version of a server copy already held for it, if any. */
  serverCopyVersion: number | null;
}

export interface IncomingChange {
  action: "upsert" | "delete";
  version: number;
}

export type Reconciliation =
  /** Store the server's state as the local record (create or replace). */
  | { kind: "write" }
  /** Delete the clean local record. */
  | { kind: "remove" }
  /** The server's delete came back: drop the local tombstone. */
  | { kind: "purge-tombstone" }
  /** Local changes are waiting: keep the local record, keep the server's state beside it. */
  | { kind: "hold" }
  | { kind: "skip"; reason: "other-scope" | "stale" | "tombstoned" | "absent" };

/**
 * Decides one remote change for `scope`. Order matters: another scope's record is never touched
 * (account isolation), local changes are never overwritten, a local delete is never undone, and
 * anything not newer than what the device has (including its own uploads coming back) is ignored.
 */
export const reconcileRemoteChange = (scope: string, local: LocalEntity, change: IncomingChange): Reconciliation => {
  if (local.recordScope !== null && local.recordScope !== scope) return { kind: "skip", reason: "other-scope" };
  if (local.pendingOperations > 0) {
    const newest = Math.max(local.serverCopyVersion ?? 0, local.serverVersion ?? 0);
    return change.version > newest ? { kind: "hold" } : { kind: "skip", reason: "stale" };
  }
  if (local.tombstone) return change.action === "delete" ? { kind: "purge-tombstone" } : { kind: "skip", reason: "tombstoned" };
  if (local.recordScope === null) return change.action === "upsert" ? { kind: "write" } : { kind: "skip", reason: "absent" };
  if (change.version <= (local.serverVersion ?? 0)) return { kind: "skip", reason: "stale" };
  return change.action === "upsert" ? { kind: "write" } : { kind: "remove" };
};

/**
 * After the server accepted a local operation, decides a server copy that was held while it was
 * pending. Not newer than the accepted version: it was this device's own change (or older), drop
 * it. Newer and nothing else waiting: apply it now, because the pull cursor already passed it.
 * Newer with more local changes waiting: keep holding it (those will likely conflict and need it).
 * A held delete that is the echo of this device's own accepted delete also ends its tombstone,
 * because the pull already passed it and won't bring it again.
 */
export const reconcileHeldCopy = (
  copy: IncomingChange,
  acceptedVersion: number,
  pendingOperations: number,
): "drop" | "drop-and-purge-tombstone" | "apply" | "keep" => {
  if (copy.version <= acceptedVersion) return copy.action === "delete" ? "drop-and-purge-tombstone" : "drop";
  return pendingOperations === 0 ? "apply" : "keep";
};

/**
 * The local record for a server session. The local `version` only guards edits between this
 * device's pages, so it moves past the previous one instead of copying the server version.
 * Notes (`description`), tags, pinned and archived come along (since 2026-10-18); a device that
 * stores the workspace keeps it beside the session (the extension's `workspaceId`).
 */
export const toLocalSession = (detail: ApiSessionDetail, previousLocalVersion: number | null): SavedSession => ({
  id: detail.id,
  schemaVersion: SESSION_SCHEMA_VERSION,
  name: detail.name,
  createdAt: detail.createdAt,
  updatedAt: detail.updatedAt,
  sourceDeviceId: detail.sourceDeviceId,
  sourceDeviceName: detail.sourceDeviceName,
  version: (previousLocalVersion ?? 0) + 1,
  windows: detail.windows,
  description: detail.description,
  tags: detail.tags,
  isPinned: detail.isPinned,
  isArchived: detail.isArchived,
});
