import { z } from "zod";
import { pushOperationSchema, pushResultSchema, type PushOperation, type PushResult } from "@sessionhub/contracts/api-sync";
import type { PrismaClient } from "@sessionhub/database/client";
import type { DevicePrincipal } from "../devices/credentials";
import { RollbackWith, ServiceError } from "../service-errors";
import { createSessionInTx, deleteSessionInTx, updateSessionInTx, type DeleteResult, type WriteResult } from "../sessions/mutations";
import { nextSequence, runMutation, type Tx } from "./transaction";

/** The authenticated device a push writes as (provenance on created sessions and versions). */
export interface Pusher extends DevicePrincipal {
  deviceName: string;
}

type Receipted = Extract<PushResult, { status: "accepted" | "conflict" | "rejected" }>;
/** What a receipt stores: the outcome without `replayed`, which describes the delivery. */
type StoredResult = Receipted extends infer R ? (R extends Receipted ? Omit<R, "replayed"> : never) : never;
type StoredAccepted = Extract<StoredResult, { status: "accepted" }>;

const REJECTED_CODES = ["NOT_FOUND", "ID_IN_USE", "INVALID_WORKSPACE"] as const;
const isRejectedCode = (code: string): code is (typeof REJECTED_CODES)[number] => (REJECTED_CODES as readonly string[]).includes(code);

/** The device row behind a principal, with what the push route needs to know about its account. */
export const loadPusher = async (prisma: PrismaClient, { userId, deviceId }: DevicePrincipal): Promise<{ pusher: Pusher; emailVerified: boolean }> => {
  const device = await prisma.device.findFirstOrThrow({
    where: { id: deviceId, userId },
    select: { displayName: true, user: { select: { emailVerified: true } } },
  });
  return { pusher: { userId, deviceId, deviceName: device.displayName }, emailVerified: device.user.emailVerified };
};

/** One operation per session per push: a later one could otherwise apply on top of an earlier one's conflict. */
export const hasRepeatedEntity = (operations: unknown[]): boolean => {
  const seen = new Set<string>();
  for (const operation of operations) {
    const id = typeof operation === "object" && operation !== null && "entityId" in operation ? operation.entityId : undefined;
    if (typeof id !== "string") continue;
    if (seen.has(id)) return true;
    seen.add(id);
  }
  return false;
};

const receiptKey = (pusher: Pusher, clientOperationId: string) => ({ userId: pusher.userId, deviceId: pusher.deviceId, clientOperationId });

/** A stored receipt answered again, validated like any other result. */
const replay = (payload: unknown): PushResult => pushResultSchema.parse({ ...(payload as object), replayed: true });

const accepted = (operation: PushOperation, serverVersion: number, serverSequence: string | null): StoredAccepted => ({
  status: "accepted",
  clientOperationId: operation.clientOperationId,
  entityId: operation.entityId,
  serverVersion,
  serverSequence,
});

/** Runs the shared session mutation for one operation inside the push transaction. */
const apply = async (tx: Tx, pusher: Pusher, sequence: bigint, operation: PushOperation): Promise<StoredAccepted> => {
  const source = { deviceId: pusher.deviceId, deviceName: pusher.deviceName };
  try {
    if (operation.action === "delete") {
      const result = await deleteSessionInTx(tx, pusher.userId, sequence, operation.entityId, operation.expectedVersion);
      return accepted(operation, result.version, result.sequence);
    }
    const { name, windows } = operation.payload;
    const { detail, sequence: written } =
      operation.expectedVersion === 0
        ? await createSessionInTx(tx, pusher.userId, sequence, { id: operation.entityId, name, description: null, workspaceId: null, isPinned: false, windows }, source)
        : await updateSessionInTx(tx, pusher.userId, sequence, operation.entityId, { expectedVersion: operation.expectedVersion, name, windows }, source);
    return accepted(operation, detail.version, written);
  } catch (error) {
    // The service's own idempotent repeat (same create content again, delete of a tombstone): nothing
    // was written, so roll back without a receipt; the same operation computes the same answer again.
    if (!(error instanceof RollbackWith)) throw error;
    const value = error.value as WriteResult | DeleteResult;
    const result: PushResult = { ...accepted(operation, "detail" in value ? value.detail.version : value.version, null), replayed: false };
    throw new RollbackWith(result);
  }
};

/**
 * Records a conflict or rejection outside the rolled-back mutation (it wrote nothing, so it used no
 * change-log sequence). If a concurrent copy of this operation recorded first, answers with that.
 */
const recordOutcome = async (prisma: PrismaClient, key: ReturnType<typeof receiptKey>, result: Exclude<StoredResult, StoredAccepted>): Promise<PushResult> => {
  try {
    await prisma.syncOperationReceipt.create({ data: { ...key, resultStatus: result.status, resultPayload: result } });
    return { ...result, replayed: false };
  } catch (error) {
    if ((error as { code?: unknown }).code !== "P2002") throw error;
    return replay((await prisma.syncOperationReceipt.findUniqueOrThrow({ where: { userId_deviceId_clientOperationId: key } })).resultPayload);
  }
};

const operationIdOf = (raw: unknown): string | null => {
  const id = typeof raw === "object" && raw !== null && "clientOperationId" in raw ? raw.clientOperationId : undefined;
  return z.uuid().safeParse(id).success ? (id as string) : null;
};

const retryable = (clientOperationId: string): PushResult => ({
  status: "retryable_error",
  clientOperationId,
  message: "This change couldn't be saved right now. It will be sent again.",
});

/**
 * One operation, one transaction (docs/SYNC_PROTOCOL.md section 8): the user's clock lock first,
 * then the receipt lookup, so duplicate deliveries of one operation serialize and all but the
 * first get its stored result. The mutation and its receipt commit together.
 */
const pushOne = async (prisma: PrismaClient, pusher: Pusher, raw: unknown): Promise<PushResult> => {
  const parsed = pushOperationSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    return { status: "validation_error", clientOperationId: operationIdOf(raw), message: "This change isn't valid, so it was not saved.", issues };
  }
  const operation = parsed.data;
  const key = receiptKey(pusher, operation.clientOperationId);
  let failure: ServiceError;
  try {
    return await runMutation(prisma, async (tx): Promise<PushResult> => {
      const sequence = await nextSequence(tx, pusher.userId);
      const receipt = await tx.syncOperationReceipt.findUnique({ where: { userId_deviceId_clientOperationId: key } });
      if (receipt) throw new RollbackWith(replay(receipt.resultPayload));
      const result = await apply(tx, pusher, sequence, operation);
      await tx.syncOperationReceipt.create({ data: { ...key, resultStatus: "accepted", resultPayload: result } });
      return { ...result, replayed: false };
    });
  } catch (error) {
    if (!(error instanceof ServiceError) || !(error.code === "VERSION_CONFLICT" || isRejectedCode(error.code))) {
      // Class name only: never log payloads or URLs.
      console.error(`[sync-push] unexpected ${error instanceof Error ? error.name : typeof error}`);
      return retryable(operation.clientOperationId);
    }
    failure = error;
  }
  const base = { clientOperationId: operation.clientOperationId, entityId: operation.entityId, message: failure.message };
  const outcome: Exclude<StoredResult, StoredAccepted> =
    failure.code === "VERSION_CONFLICT"
      ? { ...base, status: "conflict", code: "VERSION_CONFLICT", expectedVersion: operation.expectedVersion, serverVersion: failure.details.serverVersion ?? null }
      : { ...base, status: "rejected", code: failure.code as (typeof REJECTED_CODES)[number] };
  return recordOutcome(prisma, key, outcome).catch(() => retryable(operation.clientOperationId));
};

/** Applies operations in request order, each on its own: a push is not all-or-nothing. */
export const pushOperations = async (prisma: PrismaClient, pusher: Pusher, operations: unknown[]): Promise<PushResult[]> => {
  const results: PushResult[] = [];
  for (const operation of operations) results.push(await pushOne(prisma, pusher, operation));
  return results;
};
