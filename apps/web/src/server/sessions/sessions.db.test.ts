import { randomUUID } from "node:crypto";
import { createSessionRequestSchema, type CreateSessionRequest } from "@sessionhub/contracts/api-sessions";
import { getPrisma } from "@sessionhub/database/client";
import { afterAll, describe, expect, it } from "vitest";
import { createSession, deleteSession, updateSession } from "./mutations";
import { getSessionDetail, listSessionsPage } from "./queries";

const prisma = getPrisma();
afterAll(async () => {
  await prisma.$disconnect();
});

const newUser = () => prisma.user.create({ data: { id: `user_${randomUUID()}`, name: "U", email: `${randomUUID()}@example.test` } });
const group = "4b0c1c52-7a4d-4a0e-9a59-6d5f1f1e2b3c";
const body = (overrides: Partial<CreateSessionRequest> = {}): CreateSessionRequest =>
  createSessionRequestSchema.parse({
    name: "Research",
    windows: [
      {
        groups: [{ id: group, title: "Docs", color: "blue" }],
        tabs: [{ url: "https://a.test/", title: "A", groupId: group }, { url: "javascript:alert(1)", title: "Bad" }],
      },
      { tabs: [{ url: "https://b.test/", title: "B", pinned: true }] },
    ],
    ...overrides,
  });

const clock = async (userId: string) => (await prisma.userSyncClock.findUnique({ where: { userId } }))?.lastSequence ?? 0n;
const changes = (userId: string) => prisma.syncChange.findMany({ where: { userId }, orderBy: { sequence: "asc" } });
const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
};

describe("create", () => {
  it("writes rows, an immutable version and one ordered change in one transaction", async () => {
    const user = await newUser();
    const { detail, sequence } = await createSession(prisma, user.id, body());
    expect(detail).toMatchObject({ version: 1, tabCount: 3, windowCount: 2, sourceDeviceName: "Web", sourceDeviceId: null });
    expect(detail.windows[0]!.tabs.map((tab) => tab.eligibility)).toEqual(["restorable", "unsafe"]);
    expect(detail.windows[0]!.tabs[0]!.groupId).toBe(detail.windows[0]!.groups[0]!.id);
    expect(sequence).toBe("1");
    expect(await clock(user.id)).toBe(1n);
    expect(await getSessionDetail(prisma, user.id, detail.id)).toEqual(detail);
    const version = await prisma.sessionVersion.findUniqueOrThrow({ where: { sessionId_version: { sessionId: detail.id, version: 1 } } });
    expect(version.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(await changes(user.id)).toMatchObject([{ sequence: 1n, entityId: detail.id, changeKind: "upsert", entityVersion: 1 }]);
  });

  it("treats an exact retry with the same id as a no-op and rejects a different body", async () => {
    const user = await newUser();
    const id = randomUUID();
    const first = await createSession(prisma, user.id, body({ id }));
    const retry = await createSession(prisma, user.id, body({ id }));
    expect(retry).toEqual({ detail: first.detail, sequence: null });
    expect(await clock(user.id)).toBe(1n);
    expect(await failure(createSession(prisma, user.id, body({ id, name: "Different" })))).toBe("ID_IN_USE");
    expect(await changes(user.id)).toHaveLength(1);
  });
});

describe("update and delete", () => {
  it("increments the version, replaces structure and records each revision", async () => {
    const user = await newUser();
    const { detail } = await createSession(prisma, user.id, body());
    const oldWindowIds = detail.windows.map((window) => window.id);
    const updated = await updateSession(prisma, user.id, detail.id, {
      expectedVersion: 1,
      name: "Renamed",
      windows: [{ groups: [], tabs: [{ url: "https://c.test/", title: "C", pinned: false, groupId: null }] }],
    });
    expect(updated.detail).toMatchObject({ name: "Renamed", version: 2, tabCount: 1, windowCount: 1 });
    expect(await prisma.savedSessionWindow.count({ where: { id: { in: oldWindowIds } } })).toBe(0);
    expect(await prisma.sessionVersion.count({ where: { sessionId: detail.id } })).toBe(2);
    expect((await changes(user.id)).map((c) => c.sequence)).toEqual([1n, 2n]);
  });

  it("returns a conflict with the server state for a stale version and writes nothing", async () => {
    const user = await newUser();
    const { detail } = await createSession(prisma, user.id, body());
    await updateSession(prisma, user.id, detail.id, { expectedVersion: 1, isPinned: true });
    try {
      await updateSession(prisma, user.id, detail.id, { expectedVersion: 1, name: "Stale edit" });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: "VERSION_CONFLICT", conflict: { expectedVersion: 1, serverVersion: 2, serverState: { isPinned: true } } });
    }
    expect(await clock(user.id)).toBe(2n);
    expect((await getSessionDetail(prisma, user.id, detail.id))?.name).toBe("Research");
  });

  it("tombstones on delete, is idempotent and never lets a stale edit resurrect it", async () => {
    const user = await newUser();
    const { detail } = await createSession(prisma, user.id, body());
    expect(await failure(deleteSession(prisma, user.id, detail.id, 7))).toBe("VERSION_CONFLICT");
    const deleted = await deleteSession(prisma, user.id, detail.id, 1);
    expect(deleted).toMatchObject({ id: detail.id, version: 2, sequence: "2" });
    expect(await deleteSession(prisma, user.id, detail.id, 1)).toMatchObject({ version: 2, sequence: null });
    expect(await getSessionDetail(prisma, user.id, detail.id)).toBeNull();
    expect(await failure(updateSession(prisma, user.id, detail.id, { expectedVersion: 2, name: "Back" }))).toBe("NOT_FOUND");
    expect((await changes(user.id)).map((c) => [c.sequence, c.changeKind])).toEqual([[1n, "upsert"], [2n, "delete"]]);
    expect((await listSessionsPage(prisma, user.id, { limit: 10 })).items).toEqual([]);
  });
});

describe("cross-user denial", () => {
  it("another user can't read, change or delete a session, and nothing is written", async () => {
    const [alice, bob] = await Promise.all([newUser(), newUser()]);
    const { detail } = await createSession(prisma, alice.id, body());
    expect(await getSessionDetail(prisma, bob.id, detail.id)).toBeNull();
    expect(await failure(updateSession(prisma, bob.id, detail.id, { expectedVersion: 1, name: "Pwned" }))).toBe("NOT_FOUND");
    expect(await failure(deleteSession(prisma, bob.id, detail.id, 1))).toBe("NOT_FOUND");
    expect(await failure(createSession(prisma, bob.id, body({ id: detail.id })))).toBe("ID_IN_USE");
    expect((await listSessionsPage(prisma, bob.id, { limit: 10 })).items).toEqual([]);

    expect(await getSessionDetail(prisma, alice.id, detail.id)).toEqual(detail);
    expect(await changes(bob.id)).toEqual([]);
    expect(await prisma.userSyncClock.findUnique({ where: { userId: bob.id } })).toBeNull();
    expect(await clock(alice.id)).toBe(1n);
  });

  it("rejects another user's or a deleted workspace", async () => {
    const [alice, bob] = await Promise.all([newUser(), newUser()]);
    const bobs = await prisma.workspace.create({ data: { userId: bob.id, name: "Bob" } });
    const gone = await prisma.workspace.create({ data: { userId: alice.id, name: "Gone", deletedAt: new Date() } });
    const own = await prisma.workspace.create({ data: { userId: alice.id, name: "Mine" } });
    expect(await failure(createSession(prisma, alice.id, body({ workspaceId: bobs.id })))).toBe("INVALID_WORKSPACE");
    expect(await failure(createSession(prisma, alice.id, body({ workspaceId: gone.id })))).toBe("INVALID_WORKSPACE");
    expect((await createSession(prisma, alice.id, body({ workspaceId: own.id }))).detail.workspaceId).toBe(own.id);
  });
});

describe("concurrency", () => {
  it("assigns gap-free, unique sequences to concurrent writes", async () => {
    const user = await newUser();
    await Promise.all(Array.from({ length: 20 }, (_, index) => createSession(prisma, user.id, body({ name: `S${index}` }))));
    expect((await changes(user.id)).map((c) => Number(c.sequence))).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });

  it("accepts exactly one of several concurrent edits of the same version", async () => {
    const user = await newUser();
    const { detail } = await createSession(prisma, user.id, body());
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) => failure(updateSession(prisma, user.id, detail.id, { expectedVersion: 1, name: `Edit ${index}` }))),
    );
    expect(results.filter((r) => r === "resolved")).toHaveLength(1);
    expect(results.filter((r) => r === "VERSION_CONFLICT")).toHaveLength(9);
    expect((await getSessionDetail(prisma, user.id, detail.id))?.version).toBe(2);
    expect(await clock(user.id)).toBe(2n);
  });
});

describe("pagination", () => {
  it("pages newest first without duplicates and rejects tampered cursors", async () => {
    const user = await newUser();
    for (let index = 0; index < 7; index += 1) await createSession(prisma, user.id, body({ name: `S${index}` }));
    const seen: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await listSessionsPage(prisma, user.id, { limit: 3, cursor });
      seen.push(...page.items.map((item) => item.name));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(["S6", "S5", "S4", "S3", "S2", "S1", "S0"]);
    expect(await failure(listSessionsPage(prisma, user.id, { limit: 3, cursor: "not-a-cursor" }))).toBe("INVALID_CURSOR");
  });
});
