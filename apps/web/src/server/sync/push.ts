import { z } from "zod";
import { pushOperationSchema, pushResultSchema, type PushOperation, type PushResult } from "@sessionhub/contracts/api-sync";
import type { PrismaClient } from "@sessionhub/database/client";
import type { DevicePrincipal } from "../devices/credentials";
import { RollbackWith, ServiceError } from "../service-errors";
import { createSessionInTx, deleteSessionInTx, updateSessionInTx } from "../sessions/mutations";
import { createWorkspaceInTx, deleteWorkspaceInTx, updateWorkspaceInTx } from "../workspaces/service";
import { log } from "../observability/logger";
import { nextSequence, runMutation, type Tx } from "./transaction";

/** The authenticated device a push writes as (provenance on created sessions and versions). */
export interface Pusher extends DevicePrincipal {
  deviceName: string;
}

type Receipted = Extract<PushResult, { status: "accepted" | "conflict" | "rejected" }>;
/** What a receipt stores: the outcome without `replayed`, which describes the delivery. */
type StoredResult = Receipted extends infer R ? (R extends Receipted ? Omit<R, "replayed"> : never) : never;
type StoredAccepted = Extract<StoredResult, { status: "accepted" }>;

const REJECTED_CODES = ["NOT_FOUND", "ID_IN_USE", "INVALID_WORKSPACE", "LIMIT_REACHED", "WORKSPACE_NOT_EMPTY"] as const;
const isRejectedCode = (code: string): code is (typeof REJECTED_CODES)[number] => (REJECTED_CODES as readonly string[]).includes(code);

/** The device row behind a principal, with what the push route needs to know about its account. */
export const loadPusher = async (prisma: PrismaClient, { userId, deviceId }: DevicePrincipal): Promise<{ pusher: Pusher; emailVerified: boolean }> => {
  const device = await prisma.device.findFirstOrThrow({
    where: { id: deviceId, userId },
    select: { displayName: true, user: { select: { emailVerified: true } } },
  });
  return { pusher: { userId, deviceId, deviceName: device.displayName }, emailVerified: device.user.emailVerified };
};

/** One operation per entity (session or workspace) per push: a later one could otherwise apply on top of an earlier one's conflict. */
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

type SessionOperation = Extract<PushOperation, { entityType: "savedSession" }>;
type WorkspaceOperation = Extract<PushOperation, { entityType: "workspace" }>;
type Written = { version: number; sequence: string | null };

/** The version a service's idempotent repeat answered with (a session or workspace detail, or a tombstone). */
const repeatedVersion = (value: unknown): number => {
  const answer = value as { detail?: { version: number }; workspace?: { version: number }; version?: number };
  return answer.detail?.version ?? answer.workspace?.version ?? answer.version ?? 1;
};

/**
 * Runs one write. The service's own idempotent repeat (same create content again, delete of a
 * tombstone) wrote nothing, so it rolls back without a receipt; the same operation computes the
 * same answer again.
 */
const acceptedOrRepeat = async (operation: PushOperation, write: () => Promise<Written>): Promise<StoredAccepted> => {
  try {
    const { version, sequence } = await write();
    return accepted(operation, version, sequence);
  } catch (error) {
    if (!(error instanceof RollbackWith)) throw error;
    const result: PushResult = { ...accepted(operation, repeatedVersion(error.value), null), replayed: false };
    throw new RollbackWith(result);
  }
};

/** A session upload through the shared session mutations. An absent workspaceId keeps the server's. */
const applySession = (tx: Tx, pusher: Pusher, sequence: bigint, operation: SessionOperation) =>
  acceptedOrRepeat(operation, async () => {
    if (operation.action === "delete") return deleteSessionInTx(tx, pusher.userId, sequence, operation.entityId, operation.expectedVersion);
    const source = { deviceId: pusher.deviceId, deviceName: pusher.deviceName };
    const { name, windows, workspaceId } = operation.payload;
    const { detail, sequence: written } =
      operation.expectedVersion === 0
        ? await createSessionInTx(tx, pusher.userId, sequence, { id: operation.entityId, name, description: null, workspaceId: workspaceId ?? null, isPinned: false, windows }, source)
        : await updateSessionInTx(tx, pusher.userId, sequence, operation.entityId, { expectedVersion: operation.expectedVersion, name, windows, workspaceId }, source);
    return { version: detail.version, sequence: written };
  });

/** A workspace upload through the workspace service (same rules as the REST API). Absent fields keep the server's. */
const applyWorkspace = (tx: Tx, userId: string, sequence: bigint, operation: WorkspaceOperation) =>
  acceptedOrRepeat(operation, async () => {
    if (operation.action === "delete") return deleteWorkspaceInTx(tx, userId, sequence, operation.entityId, operation.expectedVersion);
    const { name, description, icon, color, position } = operation.payload;
    const { workspace, sequence: written } =
      operation.expectedVersion === 0
        ? await createWorkspaceInTx(tx, userId, sequence, { id: operation.entityId, name, description: description ?? null, icon: icon ?? null, color: color ?? null, position: position ?? 0 })
        : await updateWorkspaceInTx(tx, userId, sequence, operation.entityId, { expectedVersion: operation.expectedVersion, name, description, icon, color, position });
    return { version: workspace.version, sequence: written };
  });

const apply = (tx: Tx, pusher: Pusher, sequence: bigint, operation: PushOperation): Promise<StoredAccepted> =>
  operation.entityType === "workspace" ? applyWorkspace(tx, pusher.userId, sequence, operation) : applySession(tx, pusher, sequence, operation);

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
      // Class name only: never payloads or URLs.
      log("error", "sync_push_unexpected_error", { errorClass: error instanceof Error ? error.name : typeof error });
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
