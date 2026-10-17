import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "../src/client";

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** A Better Auth-shaped user (string id, as Better Auth generates). */
const createUser = (label: string) =>
  prisma.user.create({ data: { id: `user_${label}_${randomUUID()}`, name: label, email: `${label}-${randomUUID()}@example.test` } });

/** A session with one window holding a group and two tabs (one grouped). */
const createSession = async (userId: string, extra: { workspaceId?: string; sourceDeviceId?: string } = {}) => {
  const session = await prisma.savedSession.create({
    data: { userId, name: "Research", ...extra, windowCount: 1, tabCount: 2 },
  });
  const window = await prisma.savedSessionWindow.create({ data: { sessionId: session.id, sortOrder: 0 } });
  const group = await prisma.savedSessionGroup.create({ data: { windowId: window.id, title: "Docs", color: "blue", sortOrder: 0 } });
  await prisma.savedSessionTab.createMany({
    data: [
      { windowId: window.id, groupId: group.id, url: "https://a.test/", title: "A", sortOrder: 0, eligibility: "restorable" },
      { windowId: window.id, url: "chrome://settings", title: "Settings", sortOrder: 1, eligibility: "browser_internal" },
    ],
  });
  return { session, window, group };
};

describe("account ownership enforced by the database", () => {
  it("rejects a saved session that points at another user's workspace", async () => {
    const [alice, bob] = await Promise.all([createUser("alice"), createUser("bob")]);
    const bobsWorkspace = await prisma.workspace.create({ data: { userId: bob.id, name: "Bob's" } });
    await expect(prisma.savedSession.create({ data: { userId: alice.id, name: "x", workspaceId: bobsWorkspace.id } })).rejects.toMatchObject({
      code: "P2003",
    });
    const ownWorkspace = await prisma.workspace.create({ data: { userId: alice.id, name: "Alice's" } });
    await expect(prisma.savedSession.create({ data: { userId: alice.id, name: "x", workspaceId: ownWorkspace.id } })).resolves.toBeTruthy();
  });

  it("rejects a saved session whose source device belongs to another user", async () => {
    const [alice, bob] = await Promise.all([createUser("alice"), createUser("bob")]);
    const bobsDevice = await prisma.device.create({ data: { userId: bob.id, installationId: randomUUID(), displayName: "Bob's Mac" } });
    await expect(prisma.savedSession.create({ data: { userId: alice.id, name: "x", sourceDeviceId: bobsDevice.id } })).rejects.toMatchObject({
      code: "P2003",
    });
  });

  it("rejects a tab grouped under a group from another window", async () => {
    const alice = await createUser("alice");
    const { session, group } = await createSession(alice.id);
    const otherWindow = await prisma.savedSessionWindow.create({ data: { sessionId: session.id, sortOrder: 1 } });
    await expect(
      prisma.savedSessionTab.create({
        data: { windowId: otherWindow.id, groupId: group.id, url: "https://b.test/", sortOrder: 0, eligibility: "restorable" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("rejects receipts and versions that mix users and devices", async () => {
    const [alice, bob] = await Promise.all([createUser("alice"), createUser("bob")]);
    const bobsDevice = await prisma.device.create({ data: { userId: bob.id, installationId: randomUUID(), displayName: "Bob's" } });
    await expect(
      prisma.syncOperationReceipt.create({
        data: { userId: alice.id, deviceId: bobsDevice.id, clientOperationId: randomUUID(), resultStatus: "accepted", resultPayload: {} },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    const { session } = await createSession(bob.id);
    await expect(
      prisma.sessionVersion.create({ data: { sessionId: session.id, userId: alice.id, version: 1, payload: {}, checksum: "x" } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("uniqueness and idempotency keys", () => {
  it("allows one device row per installation per user", async () => {
    const alice = await createUser("alice");
    const installationId = randomUUID();
    await prisma.device.create({ data: { userId: alice.id, installationId, displayName: "Windows" } });
    await expect(prisma.device.create({ data: { userId: alice.id, installationId, displayName: "Again" } })).rejects.toMatchObject({ code: "P2002" });
    const bob = await createUser("bob");
    await expect(prisma.device.create({ data: { userId: bob.id, installationId, displayName: "Bob" } })).resolves.toBeTruthy();
  });

  it("keeps the per-user change sequence and operation receipts unique", async () => {
    const alice = await createUser("alice");
    const change = { userId: alice.id, sequence: 1n, entityType: "saved_session", entityId: randomUUID(), changeKind: "upsert", entityVersion: 1 } as const;
    await prisma.syncChange.create({ data: change });
    await expect(prisma.syncChange.create({ data: { ...change, entityId: randomUUID() } })).rejects.toMatchObject({ code: "P2002" });

    const device = await prisma.device.create({ data: { userId: alice.id, installationId: randomUUID(), displayName: "Win" } });
    const receipt = { userId: alice.id, deviceId: device.id, clientOperationId: randomUUID(), resultStatus: "accepted", resultPayload: { ok: true } } as const;
    await prisma.syncOperationReceipt.create({ data: receipt });
    await expect(prisma.syncOperationReceipt.create({ data: receipt })).rejects.toMatchObject({ code: "P2002" });
  });

  it("keeps window, group and tab ordering unique", async () => {
    const alice = await createUser("alice");
    const { session, window } = await createSession(alice.id);
    await expect(prisma.savedSessionWindow.create({ data: { sessionId: session.id, sortOrder: 0 } })).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.savedSessionTab.create({ data: { windowId: window.id, url: "https://dup.test/", sortOrder: 1, eligibility: "restorable" } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("deletion", () => {
  it("deleting a saved session removes its windows, groups, tabs and versions", async () => {
    const alice = await createUser("alice");
    const { session, window } = await createSession(alice.id);
    await prisma.sessionVersion.create({ data: { sessionId: session.id, userId: alice.id, version: 1, payload: { windows: [] }, checksum: "c" } });
    await prisma.savedSession.delete({ where: { id: session.id } });
    expect(await prisma.savedSessionWindow.count({ where: { id: window.id } })).toBe(0);
    expect(await prisma.savedSessionTab.count({ where: { windowId: window.id } })).toBe(0);
    expect(await prisma.savedSessionGroup.count({ where: { windowId: window.id } })).toBe(0);
    expect(await prisma.sessionVersion.count({ where: { sessionId: session.id } })).toBe(0);
  });

  it("blocks hard-deleting a device still referenced as a session's source", async () => {
    const alice = await createUser("alice");
    const device = await prisma.device.create({ data: { userId: alice.id, installationId: randomUUID(), displayName: "Win" } });
    const { session } = await createSession(alice.id, { sourceDeviceId: device.id });
    await expect(prisma.device.delete({ where: { id: device.id } })).rejects.toMatchObject({ code: "P2003" });
    await prisma.savedSession.update({ where: { id: session.id }, data: { sourceDeviceId: null } });
    await expect(prisma.device.delete({ where: { id: device.id } })).resolves.toBeTruthy();
  });

  it("deleting an account removes all of that user's data and nobody else's", async () => {
    const [alice, bob] = await Promise.all([createUser("alice"), createUser("bob")]);
    for (const user of [alice, bob]) {
      const device = await prisma.device.create({ data: { userId: user.id, installationId: randomUUID(), displayName: "Win" } });
      const workspace = await prisma.workspace.create({ data: { userId: user.id, name: "W" } });
      await createSession(user.id, { sourceDeviceId: device.id, workspaceId: workspace.id });
      await prisma.userSyncClock.create({ data: { userId: user.id, lastSequence: 5n } });
      await prisma.auditEvent.create({ data: { userId: user.id, kind: "device_paired", deviceId: device.id } });
    }
    await prisma.user.delete({ where: { id: alice.id } });

    for (const [user, expected] of [
      [alice, 0],
      [bob, 1],
    ] as const) {
      const where = { userId: user.id };
      expect(await prisma.savedSession.count({ where })).toBe(expected);
      expect(await prisma.device.count({ where })).toBe(expected);
      expect(await prisma.workspace.count({ where })).toBe(expected);
      expect(await prisma.userSyncClock.count({ where })).toBe(expected);
      expect(await prisma.auditEvent.count({ where })).toBe(expected);
    }
  });
});

describe("types and defaults", () => {
  it("round-trips enums, BigInt sequences, JSON payloads and timestamps", async () => {
    const alice = await createUser("alice");
    const clock = await prisma.userSyncClock.create({ data: { userId: alice.id } });
    expect(clock.lastSequence).toBe(0n);
    const updated = await prisma.userSyncClock.update({ where: { userId: alice.id }, data: { lastSequence: { increment: 9_007_199_254_740_993n } } });
    expect(updated.lastSequence).toBe(9_007_199_254_740_993n);

    const { window } = await createSession(alice.id);
    const tabs = await prisma.savedSessionTab.findMany({ where: { windowId: window.id }, orderBy: { sortOrder: "asc" } });
    expect(tabs.map((tab) => tab.eligibility)).toEqual(["restorable", "browser_internal"]);

    const settings = await prisma.userSettings.create({ data: { userId: alice.id } });
    expect(settings.preferences).toEqual({});
    expect(settings.syncEnabledAt).toBeNull();
  });

  it("rejects values longer than the contract limits", async () => {
    const alice = await createUser("alice");
    await expect(prisma.savedSession.create({ data: { userId: alice.id, name: "x".repeat(201) } })).rejects.toBeTruthy();
  });
});
