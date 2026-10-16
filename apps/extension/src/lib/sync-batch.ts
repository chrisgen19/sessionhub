import { SYNC_LIMITS, type PushOperation, type SyncSessionPayload } from "@sessionhub/contracts/api-sync";
import type { SavedSession } from "@sessionhub/contracts/session";
import type { OutboxRecord } from "./db";

/** Request bytes per push, under the server's 2 MB body cap with room for the envelope. */
export const PUSH_BYTES_MAX = 1_500_000;

const bySortOrder = (a: { sortOrder: number }, b: { sortOrder: number }) => a.sortOrder - b.sortOrder;

/**
 * The upload shape of a local session: windows, groups and tabs in order, with no local ids
 * except the group references tabs use. Tabs that never had a URL can't be stored or restored,
 * so they are left out, and so is a window left without tabs.
 */
export const toSyncPayload = (session: SavedSession): SyncSessionPayload => ({
  name: session.name,
  windows: [...session.windows]
    .sort(bySortOrder)
    .map((window) => ({
      groups: [...window.groups].sort(bySortOrder).map(({ id, title, color, collapsed }) => ({ id, title, color, collapsed })),
      tabs: [...window.tabs]
        .sort(bySortOrder)
        .filter((tab) => tab.url.length > 0)
        .map(({ title, url, pinned, groupId }) => ({ title, url, pinned, groupId })),
    }))
    .filter((window) => window.tabs.length > 0),
});

export const toPushOperation = (operation: OutboxRecord): PushOperation => {
  const fields = { clientOperationId: operation.id, entityType: operation.entityType, entityId: operation.entityId };
  return operation.action === "delete"
    ? { ...fields, action: "delete", expectedVersion: operation.expectedVersion, payload: null }
    : { ...fields, action: "upsert", expectedVersion: operation.expectedVersion, payload: toSyncPayload(operation.payload) };
};

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

export interface PushBatch {
  operations: OutboxRecord[];
  /** Operations that can never fit in a push on their own. */
  tooLarge: OutboxRecord[];
}

/**
 * Picks what to send, from an account's outbox in queue order: only the first pending operation of
 * each session (the server allows one per session per push), and nothing for a session that has an
 * unresolved conflict or rejection, because its chained follow-ups could otherwise be accepted on
 * top of another device's edit.
 */
export const selectPushBatch = (
  outbox: OutboxRecord[],
  limits: { operations: number; bytes: number } = { operations: SYNC_LIMITS.operationsPerPushMax, bytes: PUSH_BYTES_MAX },
): PushBatch => {
  const held = new Set(outbox.filter((operation) => operation.status === "conflict" || operation.status === "rejected").map((operation) => operation.entityId));
  const seen = new Set<string>();
  const batch: PushBatch = { operations: [], tooLarge: [] };
  let bytes = 0;
  for (const operation of outbox) {
    if (held.has(operation.entityId) || seen.has(operation.entityId)) continue;
    seen.add(operation.entityId);
    const size = byteLength(toPushOperation(operation));
    if (size > limits.bytes) {
      batch.tooLarge.push(operation);
      continue;
    }
    if (batch.operations.length >= limits.operations || bytes + size > limits.bytes) break;
    batch.operations.push(operation);
    bytes += size;
  }
  return batch;
};

/** 5 s doubling to a 15-minute cap, with jitter (half to the full delay) so devices don't retry in step. */
export const retryDelayMs = (failures: number, random: () => number): number => {
  const base = Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (0.5 + random() / 2));
};
