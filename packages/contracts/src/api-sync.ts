import { z } from "zod";
import { createSessionRequestSchema } from "./api-sessions";

/** Sync push contracts (docs/SYNC_PROTOCOL.md sections 5 and 13f). */

export const SYNC_PROTOCOL_VERSION = 1 as const;

export const SYNC_LIMITS = {
  /** Below the shared write burst (30): every operation costs one write token. */
  operationsPerPushMax: 25,
} as const;

/** What a saved-session upsert carries: name and structure. Web-only fields stay as they are. */
export const syncSessionPayloadSchema = z.strictObject({
  name: createSessionRequestSchema.shape.name,
  windows: createSessionRequestSchema.shape.windows,
});
export type SyncSessionPayload = z.infer<typeof syncSessionPayloadSchema>;

const operationFields = {
  clientOperationId: z.uuid(),
  entityType: z.literal("savedSession"),
  entityId: z.uuid(),
};

export const pushOperationSchema = z.discriminatedUnion("action", [
  /** expectedVersion 0 creates the session with entityId as its id. */
  z.strictObject({ ...operationFields, action: z.literal("upsert"), expectedVersion: z.int().min(0), payload: syncSessionPayloadSchema }),
  z.strictObject({ ...operationFields, action: z.literal("delete"), expectedVersion: z.int().positive(), payload: z.null() }),
]);
export type PushOperation = z.infer<typeof pushOperationSchema>;

/**
 * The envelope only: operations are validated one by one, so a single malformed operation gets
 * its own `validation_error` instead of blocking every other change in the batch.
 */
export const pushRequestSchema = z.strictObject({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  deviceId: z.uuid(),
  operations: z.array(z.unknown()).min(1).max(SYNC_LIMITS.operationsPerPushMax),
});
export type PushRequest = Omit<z.infer<typeof pushRequestSchema>, "operations"> & { operations: PushOperation[] };

/**
 * One result per operation, in request order. `replayed: true` means a receipt already existed
 * for this clientOperationId and this is the original outcome, unchanged (the protocol's
 * "duplicate"). Conflicts and rejections are receipted too, so retrying never changes them.
 */
export const pushResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("accepted"),
    clientOperationId: z.uuid(),
    entityId: z.uuid(),
    serverVersion: z.int().positive(),
    /** Change-log sequence of this write; null when it changed nothing (an idempotent repeat). */
    serverSequence: z.string().nullable(),
    replayed: z.boolean(),
  }),
  z.object({
    status: z.literal("conflict"),
    clientOperationId: z.uuid(),
    entityId: z.uuid(),
    code: z.literal("VERSION_CONFLICT"),
    expectedVersion: z.int(),
    serverVersion: z.int().nullable(),
    message: z.string(),
    replayed: z.boolean(),
  }),
  z.object({
    status: z.literal("rejected"),
    clientOperationId: z.uuid(),
    entityId: z.uuid(),
    /** NOT_FOUND: missing, deleted or another account's; ID_IN_USE: a create collided; LIMIT_REACHED: the account holds the maximum number of sessions. */
    code: z.enum(["NOT_FOUND", "ID_IN_USE", "INVALID_WORKSPACE", "LIMIT_REACHED"]),
    message: z.string(),
    replayed: z.boolean(),
  }),
  z.object({
    status: z.literal("validation_error"),
    /** Null when the operation was too malformed to carry a valid id. */
    clientOperationId: z.uuid().nullable(),
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })),
  }),
  z.object({ status: z.literal("retryable_error"), clientOperationId: z.uuid(), message: z.string() }),
]);
export type PushResult = z.infer<typeof pushResultSchema>;

export const pushResponseSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  results: z.array(pushResultSchema),
});
export type PushResponse = z.infer<typeof pushResponseSchema>;

export const SYNC_PULL_LIMITS = {
  pageSizeMax: 100,
  /** A page stops early once its payloads pass this size (it always holds at least one change). */
  pageBytesMax: 4 * 1024 * 1024,
} as const;

const pageSizeSchema = z.coerce.number().int().min(1).max(SYNC_PULL_LIMITS.pageSizeMax).default(SYNC_PULL_LIMITS.pageSizeMax);

/** No cursor: from the start of the log. The extension bootstraps instead when it has none. */
export const pullQuerySchema = z.object({ cursor: z.string().max(200).optional(), limit: pageSizeSchema });
export const bootstrapQuerySchema = z.object({ after: z.uuid().optional(), limit: pageSizeSchema });

/**
 * One canonical change. `payload` is the entity's full DTO for an upsert (ApiSessionDetail for a
 * savedSession, ApiWorkspace for a workspace) and null for a delete. Clients validate it per entity
 * type, so one change they can't read never blocks the rest of the page.
 */
export const syncChangeSchema = z.object({
  sequence: z.string().regex(/^[1-9]\d*$/),
  entityType: z.enum(["savedSession", "workspace"]),
  entityId: z.uuid(),
  action: z.enum(["upsert", "delete"]),
  version: z.int().positive(),
  payload: z.unknown(),
});
export type SyncChange = z.infer<typeof syncChangeSchema>;

export const pullResponseSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  /** The cursor this page started after (null: the start of the log). */
  cursor: z.string().nullable(),
  /** Store it in the same transaction as the page's changes, then pull again while `hasMore`. */
  nextCursor: z.string(),
  hasMore: z.boolean(),
  changes: z.array(syncChangeSchema),
});
export type PullResponse = z.infer<typeof pullResponseSchema>;

/** The latest state of one session (a delete for a tombstone), as a change without a sequence. */
export const bootstrapItemSchema = syncChangeSchema.omit({ sequence: true });
export type BootstrapItem = z.infer<typeof bootstrapItemSchema>;

export const bootstrapResponseSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  /** Change-log position read before this page's rows. Keep the first page's and pull from it after the last page. */
  cursor: z.string(),
  /** Pass as `after` for the next page; null on the last page. */
  nextAfter: z.uuid().nullable(),
  hasMore: z.boolean(),
  items: z.array(bootstrapItemSchema),
});
export type BootstrapResponse = z.infer<typeof bootstrapResponseSchema>;
