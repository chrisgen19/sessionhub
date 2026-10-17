import { SYNC_LIMITS, type PushOperation, type SyncSessionPayload } from "@sessionhub/contracts/api-sync";
import type { OutboxRecord, SessionUpload } from "./db";

/** Request bytes per push, under the server's 2 MB body cap with room for the envelope. */
export const PUSH_BYTES_MAX = 1_500_000;

const bySortOrder = (a: { sortOrder: number }, b: { sortOrder: number }) => a.sortOrder - b.sortOrder;

/**
 * The upload shape of a local session: windows, groups and tabs in order, with no local ids
 * except the group references tabs use. Tabs that never had a URL can't be stored or restored,
 * so they are left out, and so is a window left without tabs. The workspace goes along once this
 * browser knows it (absent keeps the server's).
 */
export const toSyncPayload = (session: SessionUpload): SyncSessionPayload => ({
  name: session.name,
  ...(session.workspaceId !== undefined && { workspaceId: session.workspaceId }),
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
  const fields = { clientOperationId: operation.id, entityId: operation.entityId, expectedVersion: operation.expectedVersion };
  if (operation.entityType === "workspace") {
    return operation.action === "delete"
      ? { ...fields, entityType: "workspace", action: "delete", payload: null }
      : { ...fields, entityType: "workspace", action: "upsert", payload: operation.payload };
  }
  return operation.action === "delete"
    ? { ...fields, entityType: "savedSession", action: "delete", payload: null }
    : { ...fields, entityType: "savedSession", action: "upsert", payload: toSyncPayload(operation.payload) };
};

/**
 * Entities whose earlier operations must be accepted before this one is sent: a session waits for
 * the workspace it goes into (its create may still be refused), a workspace delete for the sessions
 * it moved out (else the account refuses the delete because they are still in it).
 */
const waitsFor = (operation: OutboxRecord): string[] => {
  if (operation.entityType === "workspace") return operation.action === "delete" ? (operation.waitFor ?? []) : [];
  return operation.action === "upsert" && operation.payload.workspaceId ? [operation.payload.workspaceId] : [];
};

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

export interface PushBatch {
  operations: OutboxRecord[];
  /** Operations that can never fit in a push on their own. */
  tooLarge: OutboxRecord[];
}

/**
 * Picks what to send, from an account's outbox in queue order: only the first pending operation of
 * each entity (the server allows one per entity per push), and nothing for an entity that has an
 * unresolved conflict or rejection, because its chained follow-ups could otherwise be accepted on
 * top of another device's edit. An operation whose dependencies (`waitsFor`) still have earlier
 * operations queued waits for a later round, and so does everything after it for that entity.
 */
export const selectPushBatch = (
  outbox: OutboxRecord[],
  limits: { operations: number; bytes: number } = { operations: SYNC_LIMITS.operationsPerPushMax, bytes: PUSH_BYTES_MAX },
): PushBatch => {
  const held = new Set(outbox.filter((operation) => operation.status === "conflict" || operation.status === "rejected").map((operation) => operation.entityId));
  const firstSeq = new Map<string, number>();
  for (const operation of outbox) if (!firstSeq.has(operation.entityId)) firstSeq.set(operation.entityId, operation.seq ?? 0);
  const waiting = (operation: OutboxRecord) => waitsFor(operation).some((id) => (firstSeq.get(id) ?? Infinity) < (operation.seq ?? 0));
  const seen = new Set<string>();
  const batch: PushBatch = { operations: [], tooLarge: [] };
  let bytes = 0;
  for (const operation of outbox) {
    if (held.has(operation.entityId) || seen.has(operation.entityId)) continue;
    seen.add(operation.entityId);
    if (waiting(operation)) continue;
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
