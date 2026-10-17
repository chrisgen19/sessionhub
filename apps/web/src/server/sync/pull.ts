import { SYNC_PULL_LIMITS, type BootstrapItem, type BootstrapResponse, type PullResponse, type SyncChange } from "@sessionhub/contracts/api-sync";
import type { PrismaClient } from "@sessionhub/database/client";
import { ServiceError } from "../service-errors";
import { structureInclude, toDetail } from "../sessions/dto";
import { decodeSyncCursor, encodeSyncCursor } from "./cursor";

const ENTITY_TYPES = { saved_session: "savedSession", workspace: "workspace" } as const;

const expired = () =>
  new ServiceError("CURSOR_EXPIRED", "The server no longer has the changes after this cursor. Rebuild from a full copy (GET /api/v1/sync/bootstrap).");

const lastSequence = async (prisma: PrismaClient, userId: string): Promise<bigint> =>
  (await prisma.userSyncClock.findUnique({ where: { userId }, select: { lastSequence: true } }))?.lastSequence ?? 0n;

/** Keeps items until the page's payloads pass the byte budget; the first item always fits. */
const withinBudget = <T>(items: T[], payloadOf: (item: T) => unknown): T[] => {
  let bytes = 0;
  const page: T[] = [];
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(payloadOf(item) ?? null));
    if (page.length > 0 && bytes + size > SYNC_PULL_LIMITS.pageBytesMax) break;
    page.push(item);
    bytes += size;
  }
  return page;
};

/**
 * One page of the user's change log after `cursor`, in sequence order. The log is gap-free (every
 * write takes the user's clock lock first and replays or conflicts roll back), so a missing next
 * sequence means it was pruned, and a cursor past the clock means the server lost changes (a
 * restore from backup): both answer CURSOR_EXPIRED, and the client rebuilds from bootstrap.
 */
export const pullPage = async (prisma: PrismaClient, userId: string, cursor: string | undefined, limit: number): Promise<PullResponse> => {
  const after = cursor === undefined ? 0n : decodeSyncCursor(userId, cursor);
  const clock = await lastSequence(prisma, userId);
  if (after > clock) throw expired();
  const rows = await prisma.syncChange.findMany({ where: { userId, sequence: { gt: after } }, orderBy: { sequence: "asc" }, take: limit + 1 });
  if (after < clock && rows[0]?.sequence !== after + 1n) throw expired();
  const page = withinBudget(rows.slice(0, limit), (row) => row.payload);
  const changes: SyncChange[] = page.map((row) => ({
    sequence: row.sequence.toString(),
    entityType: ENTITY_TYPES[row.entityType],
    entityId: row.entityId,
    action: row.changeKind,
    version: row.entityVersion,
    payload: row.payload,
  }));
  const last = page.at(-1)?.sequence ?? after;
  return { protocolVersion: 1, cursor: cursor ?? null, nextCursor: encodeSyncCursor(userId, last), hasMore: page.length < rows.length, changes };
};

/**
 * One page of the user's current sessions by id, tombstones included as deletes, for a client that
 * has no usable cursor. The cursor is read before the rows, so anything written meanwhile is pulled
 * afterwards; rows newer than the cursor are fine because clients apply by version.
 */
export const bootstrapPage = async (prisma: PrismaClient, userId: string, after: string | undefined, limit: number): Promise<BootstrapResponse> => {
  const cursor = encodeSyncCursor(userId, await lastSequence(prisma, userId));
  const rows = await prisma.savedSession.findMany({
    where: { userId, ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: "asc" },
    take: limit + 1,
    include: structureInclude,
  });
  const items: BootstrapItem[] = rows.map((row) =>
    row.deletedAt
      ? { entityType: "savedSession", entityId: row.id, action: "delete", version: row.version, payload: null }
      : { entityType: "savedSession", entityId: row.id, action: "upsert", version: row.version, payload: toDetail(row) },
  );
  const page = withinBudget(items.slice(0, limit), (item) => item.payload);
  const hasMore = page.length < rows.length;
  return { protocolVersion: 1, cursor, nextAfter: hasMore ? (page.at(-1)?.entityId ?? null) : null, hasMore, items: page };
};
