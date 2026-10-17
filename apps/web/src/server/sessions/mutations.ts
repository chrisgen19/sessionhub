import { randomUUID } from "node:crypto";
import type { ApiSessionDetail, CreateSessionRequest, UpdateSessionRequest } from "@sessionhub/contracts/api-sessions";
import type { SavedWindow } from "@sessionhub/contracts/session";
import { buildCanonicalStructure } from "@sessionhub/core/session-structure";
import type { Prisma, PrismaClient } from "@sessionhub/database/client";
import { RollbackWith, ServiceError } from "../service-errors";
import { nextSequence, runMutation, type Tx } from "../sync/transaction";
import { contentChecksum } from "./checksum";
import { structureInclude, toDbEligibility, toDetail, toSummary, toWindows } from "./dto";

/** Provenance for a write. Web edits have no device; sync pushes (M4) pass the device. */
export interface WriteSource {
  deviceId: string | null;
  deviceName: string;
}
export const WEB_SOURCE: WriteSource = { deviceId: null, deviceName: "Web" };

export interface WriteResult {
  detail: ApiSessionDetail;
  /** Change-log sequence of this write; null when nothing was written (idempotent replay). */
  sequence: string | null;
}

const assertWorkspace = async (tx: Tx, userId: string, workspaceId: string | null | undefined) => {
  if (!workspaceId) return;
  const workspace = await tx.workspace.findFirst({ where: { id: workspaceId, userId, deletedAt: null }, select: { id: true } });
  if (!workspace) throw new ServiceError("INVALID_WORKSPACE", "That workspace doesn't exist in your account.");
};

const insertStructure = async (tx: Tx, sessionId: string, windows: readonly SavedWindow[]) => {
  await tx.savedSessionWindow.createMany({ data: windows.map((w) => ({ id: w.id, sessionId, sortOrder: w.sortOrder })) });
  await tx.savedSessionGroup.createMany({
    data: windows.flatMap((w) => w.groups.map((g) => ({ id: g.id, windowId: w.id, title: g.title, color: g.color, collapsed: g.collapsed, sortOrder: g.sortOrder }))),
  });
  await tx.savedSessionTab.createMany({
    data: windows.flatMap((w) =>
      w.tabs.map((t) => ({ id: t.id, windowId: w.id, groupId: t.groupId, title: t.title, url: t.url, pinned: t.pinned, sortOrder: t.sortOrder, eligibility: toDbEligibility(t.eligibility) })),
    ),
  });
};

/** Immutable revision + ordered change event, in the same transaction as the data change. */
const recordUpsert = async (tx: Tx, userId: string, sequence: bigint, detail: ApiSessionDetail, source: WriteSource) => {
  const checksum = contentChecksum(detail);
  await tx.sessionVersion.create({
    data: { sessionId: detail.id, userId, version: detail.version, payload: detail, checksum, authorDeviceId: source.deviceId },
  });
  await tx.syncChange.create({
    data: { userId, sequence, entityType: "saved_session", entityId: detail.id, changeKind: "upsert", entityVersion: detail.version, payload: detail },
  });
};

const conflict = (current: Prisma.SavedSessionGetPayload<{ include: typeof structureInclude }>, expectedVersion: number) =>
  new ServiceError("VERSION_CONFLICT", "This session changed since you loaded it. Reload and reapply your change.", {
    expectedVersion,
    serverVersion: current.version,
    serverState: current.deletedAt ? null : toDetail(current),
  });

const notFound = () => new ServiceError("NOT_FOUND", "Session not found.");

/**
 * Defense in depth: the UPDATE also matches on the expected version and "not deleted", so a
 * stale write can't succeed even if the clock lock were ever bypassed. Prisma reports a
 * non-matching update as P2025, which becomes a plain version conflict.
 */
const guarded = <T>(update: Promise<T>): Promise<T> =>
  update.catch((error: unknown) => {
    if ((error as { code?: unknown }).code === "P2025") {
      throw new ServiceError("VERSION_CONFLICT", "This session changed since you loaded it. Reload and reapply your change.");
    }
    throw error;
  });

/** The create inside the caller's transaction, after its clock lock (`nextSequence`). Sync push uses it directly. */
export const createSessionInTx = async (tx: Tx, userId: string, sequence: bigint, input: CreateSessionRequest, source: WriteSource): Promise<WriteResult> => {
  const id = input.id ?? randomUUID();
  const structure = buildCanonicalStructure(input.windows, randomUUID);
  const existing = await tx.savedSession.findUnique({ where: { id }, include: structureInclude });
  if (existing) {
    // Exact retry of our own create (same id and content): return it, write nothing.
    const content = { ...input, isArchived: false, windows: structure.windows };
    const first = existing.userId === userId && !existing.deletedAt && existing.version === 1
      ? await tx.sessionVersion.findUnique({ where: { sessionId_version: { sessionId: id, version: 1 } }, select: { checksum: true } })
      : null;
    if (first?.checksum === contentChecksum(content)) throw new RollbackWith<WriteResult>({ detail: toDetail(existing), sequence: null });
    throw new ServiceError("ID_IN_USE", "A different session already uses that id. Retry without an id or with a new one.");
  }
  await assertWorkspace(tx, userId, input.workspaceId);
  const row = await tx.savedSession.create({
    data: {
      id, userId, name: input.name, description: input.description, workspaceId: input.workspaceId, isPinned: input.isPinned,
      sourceDeviceId: source.deviceId, sourceDeviceName: source.deviceName, tabCount: structure.tabCount, windowCount: structure.windowCount,
    },
  });
  await insertStructure(tx, id, structure.windows);
  const detail = { ...toSummary(row), windows: structure.windows };
  await recordUpsert(tx, userId, sequence, detail, source);
  return { detail, sequence: sequence.toString() };
};

export const createSession = (prisma: PrismaClient, userId: string, input: CreateSessionRequest, source: WriteSource = WEB_SOURCE) =>
  runMutation(prisma, async (tx) => createSessionInTx(tx, userId, await nextSequence(tx, userId), input, source));

/** The update inside the caller's transaction, after its clock lock. */
export const updateSessionInTx = async (tx: Tx, userId: string, sequence: bigint, id: string, input: UpdateSessionRequest, source: WriteSource): Promise<WriteResult> => {
  const current = await tx.savedSession.findFirst({ where: { id, userId }, include: structureInclude });
  // Tombstones win: a deleted session can't be edited back to life.
  if (!current || current.deletedAt) throw notFound();
  if (current.version !== input.expectedVersion) throw conflict(current, input.expectedVersion);
  await assertWorkspace(tx, userId, input.workspaceId);
  const structure = input.windows ? buildCanonicalStructure(input.windows, randomUUID) : null;
  if (structure) {
    await tx.savedSessionWindow.deleteMany({ where: { sessionId: id } });
    await insertStructure(tx, id, structure.windows);
  }
  const row = await guarded(tx.savedSession.update({
    where: { id, userId, version: input.expectedVersion, deletedAt: null },
    data: {
      name: input.name, description: input.description, workspaceId: input.workspaceId, isPinned: input.isPinned, isArchived: input.isArchived,
      version: { increment: 1 },
      ...(structure ? { tabCount: structure.tabCount, windowCount: structure.windowCount } : {}),
    },
  }));
  const detail = { ...toSummary(row), windows: structure?.windows ?? toWindows(current) };
  await recordUpsert(tx, userId, sequence, detail, source);
  return { detail, sequence: sequence.toString() };
};

export const updateSession = (prisma: PrismaClient, userId: string, id: string, input: UpdateSessionRequest, source: WriteSource = WEB_SOURCE) =>
  runMutation(prisma, async (tx) => updateSessionInTx(tx, userId, await nextSequence(tx, userId), id, input, source));

export interface DeleteResult {
  id: string;
  version: number;
  deletedAt: string;
  sequence: string | null;
}

/** Soft delete: tombstone (deleted_at, version + 1) plus a delete change event. Idempotent. Runs inside the caller's transaction, after its clock lock. */
export const deleteSessionInTx = async (tx: Tx, userId: string, sequence: bigint, id: string, expectedVersion: number): Promise<DeleteResult> => {
  const current = await tx.savedSession.findFirst({ where: { id, userId }, include: structureInclude });
  if (!current) throw notFound();
  if (current.deletedAt) {
    throw new RollbackWith<DeleteResult>({ id, version: current.version, deletedAt: current.deletedAt.toISOString(), sequence: null });
  }
  if (current.version !== expectedVersion) throw conflict(current, expectedVersion);
  const row = await guarded(
    tx.savedSession.update({ where: { id, userId, version: expectedVersion, deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } }),
  );
  await tx.syncChange.create({
    data: { userId, sequence, entityType: "saved_session", entityId: id, changeKind: "delete", entityVersion: row.version },
  });
  return { id, version: row.version, deletedAt: (row.deletedAt ?? new Date()).toISOString(), sequence: sequence.toString() };
};

export const deleteSession = (prisma: PrismaClient, userId: string, id: string, expectedVersion: number) =>
  runMutation(prisma, async (tx) => deleteSessionInTx(tx, userId, await nextSequence(tx, userId), id, expectedVersion));
