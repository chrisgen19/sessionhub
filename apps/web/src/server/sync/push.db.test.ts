import { randomUUID } from "node:crypto";
import { syncSessionPayloadSchema } from "@sessionhub/contracts/api-sync";
import { getPrisma } from "@sessionhub/database/client";
import { afterAll, describe, expect, it } from "vitest";
import { pushOperations, type Pusher } from "./push";

const prisma = getPrisma();
afterAll(async () => {
  await prisma.$disconnect();
});

const newPusher = async (userId?: string): Promise<Pusher> => {
  const id = userId ?? (await prisma.user.create({ data: { id: `user_${randomUUID()}`, name: "Pat", email: `${randomUUID()}@example.test` } })).id;
  const device = await prisma.device.create({ data: { userId: id, installationId: randomUUID(), displayName: "Chrome on macOS" } });
  return { userId: id, deviceId: device.id, deviceName: device.displayName };
};

const payload = (name: string) => syncSessionPayloadSchema.parse({ name, windows: [{ tabs: [{ url: "https://a.test/", title: "A" }, { url: "https://b.test/", title: "B" }] }] });
const upsert = (entityId: string, expectedVersion: number, name = "Research") => ({
  clientOperationId: randomUUID(),
  entityType: "savedSession",
  entityId,
  action: "upsert",
  expectedVersion,
  payload: payload(name),
});
const remove = (entityId: string, expectedVersion: number) => ({ clientOperationId: randomUUID(), entityType: "savedSession", entityId, action: "delete", expectedVersion, payload: null });

const push = async (pusher: Pusher, ...operations: unknown[]) => pushOperations(prisma, pusher, operations);
const one = async (pusher: Pusher, operation: unknown) => (await push(pusher, operation))[0]!;
const clock = async (userId: string) => (await prisma.userSyncClock.findUnique({ where: { userId } }))?.lastSequence ?? 0n;

describe("sync push", () => {
  it("creates, edits and deletes through the session service, with receipts and device provenance", async () => {
    const pusher = await newPusher();
    const id = randomUUID();
    expect(await one(pusher, upsert(id, 0))).toMatchObject({ status: "accepted", entityId: id, serverVersion: 1, serverSequence: "1", replayed: false });
    expect(await one(pusher, upsert(id, 1, "Renamed"))).toMatchObject({ status: "accepted", serverVersion: 2, serverSequence: "2" });
    expect(await one(pusher, remove(id, 2))).toMatchObject({ status: "accepted", serverVersion: 3, serverSequence: "3" });

    const row = await prisma.savedSession.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ userId: pusher.userId, name: "Renamed", sourceDeviceId: pusher.deviceId, sourceDeviceName: "Chrome on macOS", version: 3 });
    expect(row.deletedAt).not.toBeNull();
    expect((await prisma.sessionVersion.findMany({ where: { sessionId: id } })).map((version) => version.authorDeviceId)).toEqual([pusher.deviceId, pusher.deviceId]);
    expect((await prisma.syncChange.findMany({ where: { userId: pusher.userId }, orderBy: { sequence: "asc" } })).map((change) => change.changeKind)).toEqual(["upsert", "upsert", "delete"]);
    expect(await prisma.syncOperationReceipt.count({ where: { userId: pusher.userId, resultStatus: "accepted" } })).toBe(3);
  });

  it("answers a repeated operation with its original result and changes nothing", async () => {
    const pusher = await newPusher();
    const create = upsert(randomUUID(), 0);
    const first = await one(pusher, create);
    const again = await one(pusher, create);
    expect(again).toEqual({ ...first, replayed: true });
    expect(await clock(pusher.userId)).toBe(1n);
    expect(await prisma.sessionVersion.count({ where: { sessionId: create.entityId } })).toBe(1);
  });

  it("makes exactly one change when the same operation arrives 20 times at once", async () => {
    const pusher = await newPusher();
    const create = upsert(randomUUID(), 0);
    const results = await Promise.all(Array.from({ length: 20 }, () => one(pusher, create)));
    expect(results.every((result) => result.status === "accepted" && result.serverVersion === 1)).toBe(true);
    expect(results.filter((result) => result.status === "accepted" && !result.replayed)).toHaveLength(1);
    expect(await clock(pusher.userId)).toBe(1n);
    expect(await prisma.syncOperationReceipt.count({ where: { userId: pusher.userId } })).toBe(1);
  });

  it("keeps a stale edit a conflict, even after the server later reaches the version it expected", async () => {
    const pusher = await newPusher();
    const id = randomUUID();
    await one(pusher, upsert(id, 0));
    await one(pusher, upsert(id, 1, "From another device"));

    const stale = upsert(id, 1, "Stale");
    expect(await one(pusher, stale)).toMatchObject({ status: "conflict", code: "VERSION_CONFLICT", expectedVersion: 1, serverVersion: 2, replayed: false });
    expect(await one(pusher, stale)).toMatchObject({ status: "conflict", serverVersion: 2, replayed: true });

    const ahead = upsert(id, 3, "Ahead of the server");
    expect(await one(pusher, ahead)).toMatchObject({ status: "conflict", serverVersion: 2 });
    await one(pusher, upsert(id, 2, "Reaches 3"));
    // Retrying the receipted conflict can't turn it into an accepted overwrite of version 3.
    expect(await one(pusher, ahead)).toMatchObject({ status: "conflict", serverVersion: 2, replayed: true });
    expect(await prisma.savedSession.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: "Reaches 3", version: 3 });
    expect(await clock(pusher.userId)).toBe(3n);
  });

  it("never reads or changes another account's session", async () => {
    const [alice, bob] = [await newPusher(), await newPusher()];
    const id = randomUUID();
    await one(alice, upsert(id, 0, "Alice's"));

    expect(await one(bob, upsert(id, 1, "Bob's edit"))).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
    expect(await one(bob, upsert(id, 0, "Bob's create"))).toMatchObject({ status: "rejected", code: "ID_IN_USE" });
    expect(await one(bob, remove(id, 1))).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
    expect(await prisma.savedSession.findUniqueOrThrow({ where: { id } })).toMatchObject({ userId: alice.userId, name: "Alice's", version: 1, deletedAt: null });
    expect(await clock(bob.userId)).toBe(0n);
  });

  it("doesn't edit a deleted session back to life, and repeats a delete harmlessly", async () => {
    const pusher = await newPusher();
    const id = randomUUID();
    await one(pusher, upsert(id, 0));
    await one(pusher, remove(id, 1));
    expect(await one(pusher, upsert(id, 2, "Resurrected"))).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
    expect(await one(pusher, remove(id, 1))).toMatchObject({ status: "accepted", serverVersion: 2, serverSequence: null });
    expect(await clock(pusher.userId)).toBe(2n);
  });

  it("validates each operation on its own, so one bad change doesn't block the others", async () => {
    const pusher = await newPusher();
    const good = upsert(randomUUID(), 0);
    const bad = { ...upsert(randomUUID(), 0), payload: { name: "No tabs", windows: [] } };
    const results = await push(pusher, bad, { clientOperationId: "nope", action: "upsert" }, good);
    expect(results.map((result) => [result.status, result.clientOperationId])).toEqual([
      ["validation_error", bad.clientOperationId],
      ["validation_error", null],
      ["accepted", good.clientOperationId],
    ]);
    expect(await prisma.syncOperationReceipt.count({ where: { userId: pusher.userId } })).toBe(1);
  });

  it("keeps receipts per device: another device's identical operation id is a new delivery", async () => {
    const first = await newPusher();
    const second = await newPusher(first.userId);
    const create = upsert(randomUUID(), 0);
    await one(first, create);
    // Same content again from the other device: the service's idempotent create, not a replay.
    expect(await one(second, create)).toMatchObject({ status: "accepted", serverVersion: 1, serverSequence: null, replayed: false });
    expect(await prisma.sessionVersion.count({ where: { sessionId: create.entityId } })).toBe(1);
  });
});

const workspace = (entityId: string, expectedVersion: number, fields: Record<string, unknown> = { name: "Project Alpha" }) => ({
  clientOperationId: randomUUID(),
  entityType: "workspace",
  entityId,
  action: "upsert",
  expectedVersion,
  payload: fields,
});
const removeWorkspace = (entityId: string, expectedVersion: number) => ({ clientOperationId: randomUUID(), entityType: "workspace", entityId, action: "delete", expectedVersion, payload: null });
const inWorkspace = (entityId: string, expectedVersion: number, workspaceId: string | null) => ({ ...upsert(entityId, expectedVersion), payload: { ...payload("Research"), workspaceId } });

describe("sync push: workspaces and assignments", () => {
  it("creates, edits and deletes a workspace through the workspace service, with receipts and change-log rows", async () => {
    const pusher = await newPusher();
    const id = randomUUID();
    expect(await one(pusher, workspace(id, 0, { name: "Alpha", color: "blue" }))).toMatchObject({ status: "accepted", entityId: id, serverVersion: 1, replayed: false });
    expect(await one(pusher, workspace(id, 1, { name: "Alpha 2" }))).toMatchObject({ status: "accepted", serverVersion: 2 });
    expect(await prisma.workspace.findUniqueOrThrow({ where: { id } })).toMatchObject({ userId: pusher.userId, name: "Alpha 2", color: "blue", position: 0, version: 2 });
    expect(await one(pusher, removeWorkspace(id, 2))).toMatchObject({ status: "accepted", serverVersion: 3 });
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
    const changes = await prisma.syncChange.findMany({ where: { userId: pusher.userId }, orderBy: { sequence: "asc" } });
    expect(changes.map((change) => [change.entityType, change.changeKind])).toEqual([["workspace", "upsert"], ["workspace", "upsert"], ["workspace", "delete"]]);
    // A repeated delete of the tombstone is accepted and writes nothing.
    expect(await one(pusher, removeWorkspace(id, 2))).toMatchObject({ status: "accepted", serverVersion: 3, serverSequence: null });
  });

  it("keeps the web's values for fields an upload leaves out, and answers repeats and stale edits", async () => {
    const pusher = await newPusher();
    const id = randomUUID();
    const create = workspace(id, 0, { name: "Alpha" });
    await one(pusher, create);
    await prisma.workspace.update({ where: { id }, data: { description: "Set on the web", icon: "folder", version: 2 } });
    expect(await one(pusher, workspace(id, 2, { name: "Renamed in the extension" }))).toMatchObject({ status: "accepted", serverVersion: 3 });
    expect(await prisma.workspace.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: "Renamed in the extension", description: "Set on the web", icon: "folder" });
    expect(await one(pusher, create)).toMatchObject({ status: "accepted", serverVersion: 1, replayed: true });
    expect(await one(pusher, workspace(id, 1, { name: "Stale" }))).toMatchObject({ status: "conflict", code: "VERSION_CONFLICT", expectedVersion: 1, serverVersion: 3 });
    // An update may carry only the field the device changed: the name set elsewhere stays.
    expect(await one(pusher, workspace(id, 3, { color: "red" }))).toMatchObject({ status: "accepted", serverVersion: 4 });
    expect(await prisma.workspace.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: "Renamed in the extension", color: "red", version: 4 });
    expect(await one(pusher, workspace(randomUUID(), 0, { color: "red" }))).toMatchObject({ status: "validation_error" });
  });

  it("assigns, keeps and removes a session's workspace; an upload without workspaceId leaves it as it is", async () => {
    const pusher = await newPusher();
    const [space, session] = [randomUUID(), randomUUID()];
    // One push: the workspace first, then a new session in it (operations apply in order).
    const results = await push(pusher, workspace(space, 0), inWorkspace(session, 0, space));
    expect(results.map((result) => result.status)).toEqual(["accepted", "accepted"]);
    expect((await prisma.savedSession.findUniqueOrThrow({ where: { id: session } })).workspaceId).toBe(space);
    expect(await one(pusher, upsert(session, 1, "Renamed, workspace untouched"))).toMatchObject({ status: "accepted", serverVersion: 2 });
    expect((await prisma.savedSession.findUniqueOrThrow({ where: { id: session } })).workspaceId).toBe(space);
    // Emptying the workspace and deleting it in one push.
    const emptied = await push(pusher, inWorkspace(session, 2, null), removeWorkspace(space, 1));
    expect(emptied.map((result) => result.status)).toEqual(["accepted", "accepted"]);
    expect((await prisma.savedSession.findUniqueOrThrow({ where: { id: session } })).workspaceId).toBeNull();
  });

  it("refuses to delete a workspace that still holds sessions, and to assign one that isn't the account's", async () => {
    const pusher = await newPusher();
    const other = await newPusher();
    const [space, theirs, session] = [randomUUID(), randomUUID(), randomUUID()];
    await push(pusher, workspace(space, 0), inWorkspace(session, 0, space));
    expect(await one(pusher, removeWorkspace(space, 1))).toMatchObject({ status: "rejected", code: "WORKSPACE_NOT_EMPTY" });
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: space } })).deletedAt).toBeNull();
    await one(other, workspace(theirs, 0));
    expect(await one(pusher, inWorkspace(randomUUID(), 0, theirs))).toMatchObject({ status: "rejected", code: "INVALID_WORKSPACE" });
    expect(await one(pusher, inWorkspace(session, 1, randomUUID()))).toMatchObject({ status: "rejected", code: "INVALID_WORKSPACE" });
    expect(await one(pusher, workspace(theirs, 1, { name: "Not mine" }))).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
  });
});
