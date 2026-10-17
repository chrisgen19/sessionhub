import { randomUUID } from "node:crypto";
import { createWorkspaceRequestSchema } from "@sessionhub/contracts/api-workspaces";
import { getPrisma } from "@sessionhub/database/client";
import { afterAll, describe, expect, it } from "vitest";
import { createWorkspace } from "../workspaces/service";
import { decodeSyncCursor, encodeSyncCursor } from "./cursor";
import { bootstrapPage, pullPage } from "./pull";
import { pushOperations, type Pusher } from "./push";

const prisma = getPrisma();
afterAll(async () => {
  await prisma.$disconnect();
});

const newPusher = async (): Promise<Pusher> => {
  const user = await prisma.user.create({ data: { id: `user_${randomUUID()}`, name: "Pat", email: `${randomUUID()}@example.test` } });
  const device = await prisma.device.create({ data: { userId: user.id, installationId: randomUUID(), displayName: "Chrome on macOS" } });
  return { userId: user.id, deviceId: device.id, deviceName: device.displayName };
};
const operation = (entityId: string, action: "upsert" | "delete", expectedVersion: number, name = "Research") => ({
  clientOperationId: randomUUID(),
  entityType: "savedSession",
  entityId,
  action,
  expectedVersion,
  payload: action === "delete" ? null : { name, windows: [{ tabs: [{ url: "https://a.test/", title: "A" }] }] },
});
const write = (pusher: Pusher, ...operations: ReturnType<typeof operation>[]) => pushOperations(prisma, pusher, operations);
const code = (promise: Promise<unknown>) => promise.then(() => "resolved", (error: { code?: string }) => error.code ?? String(error));

describe("sync pull", () => {
  it("pages through the account's log in order, sessions and workspaces, with signed cursors", async () => {
    const pusher = await newPusher();
    const id = randomUUID();
    await write(pusher, operation(id, "upsert", 0));
    await write(pusher, operation(id, "upsert", 1, "Renamed"));
    const { workspace } = await createWorkspace(prisma, pusher.userId, createWorkspaceRequestSchema.parse({ name: "Client Alpha" }));
    await write(pusher, operation(id, "delete", 2));

    const first = await pullPage(prisma, pusher.userId, undefined, 2);
    expect(first).toMatchObject({ protocolVersion: 1, cursor: null, hasMore: true });
    expect(first.changes.map(({ sequence, action, version }) => [sequence, action, version])).toEqual([["1", "upsert", 1], ["2", "upsert", 2]]);
    expect(first.changes[1]!.payload).toMatchObject({ id, name: "Renamed", version: 2, windows: [{ tabs: [{ url: "https://a.test/" }] }] });
    expect(decodeSyncCursor(pusher.userId, first.nextCursor)).toBe(2n);

    const second = await pullPage(prisma, pusher.userId, first.nextCursor, 2);
    expect(second.changes.map(({ entityType, entityId, action, payload }) => [entityType, entityId, action, payload === null])).toEqual([
      ["workspace", workspace.id, "upsert", false],
      ["savedSession", id, "delete", true],
    ]);
    expect(second.hasMore).toBe(false);

    const empty = await pullPage(prisma, pusher.userId, second.nextCursor, 100);
    expect(empty).toMatchObject({ changes: [], hasMore: false, nextCursor: second.nextCursor });
  });

  it("refuses another account's cursor and edited or malformed ones", async () => {
    const [alice, bob] = [await newPusher(), await newPusher()];
    await write(alice, operation(randomUUID(), "upsert", 0));
    const aliceCursor = (await pullPage(prisma, alice.userId, undefined, 100)).nextCursor;
    expect(await code(pullPage(prisma, bob.userId, aliceCursor, 100))).toBe("INVALID_CURSOR");
    const edited = aliceCursor.replace(/^c1\.1\./, "c1.0.");
    expect(await code(pullPage(prisma, alice.userId, edited, 100))).toBe("INVALID_CURSOR");
    for (const garbage of ["1", "c1.-1.AAAAAAAAAAAAAAAAAAAAAA", "c2.1.AAAAAAAAAAAAAAAAAAAAAA", "c1.01.AAAAAAAAAAAAAAAAAAAAAA"]) {
      expect(await code(pullPage(prisma, alice.userId, garbage, 100))).toBe("INVALID_CURSOR");
    }
  });

  it("answers CURSOR_EXPIRED when the changes after the cursor were pruned, or the cursor is ahead of the server", async () => {
    const pusher = await newPusher();
    const id = randomUUID();
    await write(pusher, operation(id, "upsert", 0));
    await write(pusher, operation(id, "upsert", 1));
    await write(pusher, operation(id, "upsert", 2));
    // Simulated retention: the two oldest changes are gone.
    await prisma.syncChange.deleteMany({ where: { userId: pusher.userId, sequence: { lte: 2n } } });

    expect(await code(pullPage(prisma, pusher.userId, undefined, 100))).toBe("CURSOR_EXPIRED");
    expect(await code(pullPage(prisma, pusher.userId, encodeSyncCursor(pusher.userId, 1n), 100))).toBe("CURSOR_EXPIRED");
    expect((await pullPage(prisma, pusher.userId, encodeSyncCursor(pusher.userId, 2n), 100)).changes.map((change) => change.sequence)).toEqual(["3"]);
    // A restored backup: the client has seen sequence 5, the server only reaches 3.
    expect(await code(pullPage(prisma, pusher.userId, encodeSyncCursor(pusher.userId, 5n), 100))).toBe("CURSOR_EXPIRED");
  });
});

describe("sync bootstrap", () => {
  it("lists current sessions by id with tombstones as deletes, from a cursor read before the rows", async () => {
    const [pusher, other] = [await newPusher(), await newPusher()];
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
    for (const id of ids) await write(pusher, operation(id, "upsert", 0));
    await write(pusher, operation(ids[1]!, "delete", 1));
    await write(other, operation(randomUUID(), "upsert", 0));

    const first = await bootstrapPage(prisma, pusher.userId, undefined, 2);
    expect(first.items.map(({ entityId, action, version }) => [entityId, action, version])).toEqual([[ids[0], "upsert", 1], [ids[1], "delete", 2]]);
    expect(first.items[1]!.payload).toBeNull();
    expect(first).toMatchObject({ hasMore: true, nextAfter: ids[1] });
    expect(decodeSyncCursor(pusher.userId, first.cursor)).toBe(4n);

    const second = await bootstrapPage(prisma, pusher.userId, first.nextAfter!, 2);
    expect(second.items.map((item) => item.entityId)).toEqual([ids[2]]);
    expect(second).toMatchObject({ hasMore: false, nextAfter: null });
    expect(second.items[0]!.payload).toMatchObject({ id: ids[2], windows: [{ tabs: [{ url: "https://a.test/" }] }] });

    // Pulling from the bootstrap cursor brings only what was written afterwards.
    expect((await pullPage(prisma, pusher.userId, first.cursor, 100)).changes).toEqual([]);
    await write(pusher, operation(ids[0]!, "upsert", 1, "After the snapshot"));
    expect((await pullPage(prisma, pusher.userId, first.cursor, 100)).changes.map((change) => [change.entityId, change.version])).toEqual([[ids[0], 2]]);
  });

  it("carries every workspace on the first page, tombstones as deletes, ahead of the sessions that reference them", async () => {
    const [pusher, other] = [await newPusher(), await newPusher()];
    const [live, gone] = [randomUUID(), randomUUID()].sort() as [string, string];
    const session = randomUUID();
    const space = (entityId: string, action: "upsert" | "delete", expectedVersion: number) => ({
      clientOperationId: randomUUID(),
      entityType: "workspace",
      entityId,
      action,
      expectedVersion,
      payload: action === "delete" ? null : { name: `Space ${entityId.slice(0, 4)}` },
    });
    await pushOperations(prisma, pusher, [space(live, "upsert", 0), space(gone, "upsert", 0), space(gone, "delete", 1)]);
    await pushOperations(prisma, pusher, [{ ...operation(session, "upsert", 0), payload: { name: "In a space", windows: [{ tabs: [{ url: "https://a.test/" }] }], workspaceId: live } }]);
    await createWorkspace(prisma, other.userId, createWorkspaceRequestSchema.parse({ name: "Someone else's" }));

    const first = await bootstrapPage(prisma, pusher.userId, undefined, 1);
    expect(first.items.map(({ entityType, entityId, action, version }) => [entityType, entityId, action, version])).toEqual([
      ["workspace", live, "upsert", 1],
      ["workspace", gone, "delete", 2],
      ["savedSession", session, "upsert", 1],
    ]);
    expect(first.items[0]!.payload).toMatchObject({ id: live, name: `Space ${live.slice(0, 4)}`, version: 1 });
    expect(first.items[2]!.payload).toMatchObject({ id: session, workspaceId: live });
    expect(first).toMatchObject({ hasMore: false, nextAfter: null });
  });

  it("sends workspaces only on the first page", async () => {
    const pusher = await newPusher();
    const ids = [randomUUID(), randomUUID()].sort();
    await pushOperations(prisma, pusher, [{ clientOperationId: randomUUID(), entityType: "workspace", entityId: randomUUID(), action: "upsert", expectedVersion: 0, payload: { name: "Only once" } }]);
    for (const id of ids) await write(pusher, operation(id, "upsert", 0));
    const first = await bootstrapPage(prisma, pusher.userId, undefined, 1);
    expect(first.items.map((item) => item.entityType)).toEqual(["workspace", "savedSession"]);
    const second = await bootstrapPage(prisma, pusher.userId, first.nextAfter ?? undefined, 1);
    expect(second.items.map((item) => [item.entityType, item.entityId])).toEqual([["savedSession", ids[1]]]);
  });
});
