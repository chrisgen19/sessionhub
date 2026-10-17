import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "@sessionhub/database/client";
import { getOverviewStats, listDevices, listSessions } from "./dashboard";

const prisma = getPrisma();
afterAll(async () => {
  await prisma.$disconnect();
});

const createUser = () => prisma.user.create({ data: { id: `user_${randomUUID()}`, name: "U", email: `${randomUUID()}@example.test` } });

const seed = async (userId: string, names: string[]) => {
  for (const [index, name] of names.entries()) {
    await prisma.savedSession.create({
      data: { userId, name, tabCount: index + 2, windowCount: 1, updatedAt: new Date(Date.UTC(2026, 9, 10 + index)) },
    });
  }
};

describe("dashboard queries", () => {
  it("only ever returns the caller's own data", async () => {
    const [alice, bob] = await Promise.all([createUser(), createUser()]);
    await seed(alice.id, ["Alice research", "Alice client work"]);
    await seed(bob.id, ["Bob secret project"]);
    await prisma.device.create({ data: { userId: bob.id, installationId: randomUUID(), displayName: "Bob's Mac" } });

    expect((await listSessions(prisma, alice.id)).map((s) => s.name)).toEqual(["Alice client work", "Alice research"]);
    expect(await listSessions(prisma, alice.id, { query: "secret" })).toEqual([]);
    expect(await listDevices(prisma, alice.id)).toEqual([]);
    expect(await getOverviewStats(prisma, alice.id)).toEqual({ sessionCount: 2, tabCount: 5, deviceCount: 0 });
    expect(await getOverviewStats(prisma, bob.id)).toEqual({ sessionCount: 1, tabCount: 2, deviceCount: 1 });
  });

  it("hides deleted and archived sessions and searches names case-insensitively", async () => {
    const user = await createUser();
    await seed(user.id, ["Frontend Research", "Old stuff", "Archived thing"]);
    await prisma.savedSession.updateMany({ where: { userId: user.id, name: "Old stuff" }, data: { deletedAt: new Date() } });
    await prisma.savedSession.updateMany({ where: { userId: user.id, name: "Archived thing" }, data: { isArchived: true } });

    expect((await listSessions(prisma, user.id)).map((s) => s.name)).toEqual(["Frontend Research"]);
    expect((await listSessions(prisma, user.id, { query: "  RESEARCH " })).map((s) => s.name)).toEqual(["Frontend Research"]);
    expect(await getOverviewStats(prisma, user.id)).toMatchObject({ sessionCount: 1, tabCount: 2 });
  });

  it("caps list size and returns zeros for a new account", async () => {
    const user = await createUser();
    await seed(user.id, ["a", "b", "c"]);
    expect(await listSessions(prisma, user.id, { take: 1000 })).toHaveLength(3);
    expect(await listSessions(prisma, user.id, { take: 2 })).toHaveLength(2);
    expect(await getOverviewStats(prisma, (await createUser()).id)).toEqual({ sessionCount: 0, tabCount: 0, deviceCount: 0 });
  });

  it("lists active devices before revoked ones, most recently seen first", async () => {
    const user = await createUser();
    const make = (displayName: string, lastSeenAt: Date | null, revokedAt: Date | null = null) =>
      prisma.device.create({ data: { userId: user.id, installationId: randomUUID(), displayName, lastSeenAt, revokedAt } });
    await make("Revoked laptop", new Date("2026-10-15"), new Date("2026-10-15"));
    await make("Never seen", null);
    await make("Windows desktop", new Date("2026-10-16"));
    expect((await listDevices(prisma, user.id)).map((d) => d.displayName)).toEqual(["Windows desktop", "Never seen", "Revoked laptop"]);
    expect((await getOverviewStats(prisma, user.id)).deviceCount).toBe(2);
  });
});
