import { randomUUID } from "node:crypto";
import {
  WORKSPACE_LIMITS,
  type ApiWorkspace,
  type CreateWorkspaceRequest,
  type ListWorkspacesResponse,
  type UpdateWorkspaceRequest,
  type WorkspaceTombstone,
} from "@sessionhub/contracts/api-workspaces";
import type { Prisma, PrismaClient } from "@sessionhub/database/client";
import { RollbackWith, ServiceError } from "../service-errors";
import { nextSequence, runMutation, type Tx } from "../sync/transaction";
import { liveSessionCount, toWorkspace } from "./dto";

type WorkspaceRow = Prisma.WorkspaceGetPayload<object>;

const notFound = () => new ServiceError("NOT_FOUND", "Workspace not found.");

const conflict = (current: WorkspaceRow, expectedVersion: number) =>
  new ServiceError("VERSION_CONFLICT", "This workspace changed since you loaded it. Reload and reapply your change.", {
    expectedVersion,
    serverVersion: current.version,
    serverState: current.deletedAt ? null : toWorkspace(current),
  });

/** Same defense in depth as sessions: the UPDATE matches the expected version too (P2025 -> conflict). */
const guarded = <T>(update: Promise<T>): Promise<T> =>
  update.catch((error: unknown) => {
    if ((error as { code?: unknown }).code === "P2025") throw new ServiceError("VERSION_CONFLICT", "This workspace changed since you loaded it.");
    throw error;
  });

const recordUpsert = (tx: Tx, userId: string, sequence: bigint, workspace: ApiWorkspace) =>
  tx.syncChange.create({
    data: { userId, sequence, entityType: "workspace", entityId: workspace.id, changeKind: "upsert", entityVersion: workspace.version, payload: workspace },
  });

export interface WorkspaceWriteResult {
  workspace: ApiWorkspace;
  /** Change-log sequence of this write; null for an idempotent replay (nothing written). */
  sequence: string | null;
}

/** All live workspaces, in display order. Bounded by WORKSPACE_LIMITS.perUserMax. */
export const listWorkspaces = async (prisma: PrismaClient, userId: string): Promise<ListWorkspacesResponse> => {
  const rows = await prisma.workspace.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: WORKSPACE_LIMITS.perUserMax,
    include: liveSessionCount,
  });
  return { items: rows.map((row) => ({ ...toWorkspace(row), sessionCount: row._count.sessions })) };
};

const sameContent = (row: WorkspaceRow, input: CreateWorkspaceRequest) =>
  row.name === input.name && row.description === input.description && row.icon === input.icon && row.color === input.color && row.position === input.position;

/** The create inside the caller's transaction, after its clock lock (REST API and sync push). */
export const createWorkspaceInTx = async (tx: Tx, userId: string, sequence: bigint, input: CreateWorkspaceRequest): Promise<WorkspaceWriteResult> => {
  const id = input.id ?? randomUUID();
  const existing = await tx.workspace.findUnique({ where: { id } });
  if (existing) {
    // Exact retry of our own create: return it and write nothing.
    if (existing.userId === userId && !existing.deletedAt && existing.version === 1 && sameContent(existing, input)) {
      throw new RollbackWith<WorkspaceWriteResult>({ workspace: toWorkspace(existing), sequence: null });
    }
    throw new ServiceError("ID_IN_USE", "A different workspace already uses that id. Retry without an id or with a new one.");
  }
  if ((await tx.workspace.count({ where: { userId, deletedAt: null } })) >= WORKSPACE_LIMITS.perUserMax) {
    throw new ServiceError("LIMIT_REACHED", `You can have up to ${WORKSPACE_LIMITS.perUserMax} workspaces. Delete one you don't use first.`);
  }
  const { id: _id, ...fields } = input;
  const workspace = toWorkspace(await tx.workspace.create({ data: { id, userId, ...fields } }));
  await recordUpsert(tx, userId, sequence, workspace);
  return { workspace, sequence: sequence.toString() };
};

export const createWorkspace = (prisma: PrismaClient, userId: string, input: CreateWorkspaceRequest) =>
  runMutation(prisma, async (tx) => createWorkspaceInTx(tx, userId, await nextSequence(tx, userId), input));

/** The update inside the caller's transaction, after its clock lock. Undefined fields stay unchanged. */
export const updateWorkspaceInTx = async (tx: Tx, userId: string, sequence: bigint, id: string, input: UpdateWorkspaceRequest): Promise<WorkspaceWriteResult> => {
  const current = await tx.workspace.findFirst({ where: { id, userId } });
  if (!current || current.deletedAt) throw notFound();
  if (current.version !== input.expectedVersion) throw conflict(current, input.expectedVersion);
  const { expectedVersion, ...changes } = input;
  const row = await guarded(
    tx.workspace.update({ where: { id, userId, version: expectedVersion, deletedAt: null }, data: { ...changes, version: { increment: 1 } } }),
  );
  const workspace = toWorkspace(row);
  await recordUpsert(tx, userId, sequence, workspace);
  return { workspace, sequence: sequence.toString() };
};

export const updateWorkspace = (prisma: PrismaClient, userId: string, id: string, input: UpdateWorkspaceRequest) =>
  runMutation(prisma, async (tx) => updateWorkspaceInTx(tx, userId, await nextSequence(tx, userId), id, input));

/**
 * Tombstone (deleted_at, version + 1) plus a delete change event; repeating it returns the same
 * tombstone. Refused while live sessions are still in the workspace: moving them out is the
 * user's decision (each move is a versioned session edit), never a silent side effect.
 */
export const deleteWorkspaceInTx = async (tx: Tx, userId: string, sequence: bigint, id: string, expectedVersion: number): Promise<WorkspaceTombstone & { sequence: string | null }> => {
  const current = await tx.workspace.findFirst({ where: { id, userId }, include: liveSessionCount });
  if (!current) throw notFound();
  if (current.deletedAt) {
    throw new RollbackWith({ id, version: current.version, deletedAt: current.deletedAt.toISOString(), sequence: null });
  }
  if (current.version !== expectedVersion) throw conflict(current, expectedVersion);
  const sessionCount = current._count.sessions;
  if (sessionCount > 0) {
    throw new ServiceError("WORKSPACE_NOT_EMPTY", "Move or delete the sessions in this workspace first.", { sessionCount });
  }
  const row = await guarded(
    tx.workspace.update({ where: { id, userId, version: expectedVersion, deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } }),
  );
  await tx.syncChange.create({ data: { userId, sequence, entityType: "workspace", entityId: id, changeKind: "delete", entityVersion: row.version } });
  return { id, version: row.version, deletedAt: (row.deletedAt ?? new Date()).toISOString(), sequence: sequence.toString() };
};

export const deleteWorkspace = (prisma: PrismaClient, userId: string, id: string, expectedVersion: number) =>
  runMutation(prisma, async (tx) => deleteWorkspaceInTx(tx, userId, await nextSequence(tx, userId), id, expectedVersion));
