import { randomUUID } from "node:crypto";
import { getPrisma } from "@sessionhub/database/client";
import { afterAll, describe, expect, it } from "vitest";
import { listDevices, renameDevice, revokeDevice } from "./service";

const prisma = getPrisma();
afterAll(async () => {
  await prisma.$disconnect();
});

const newUser = () => prisma.user.create({ data: { id: `user_${randomUUID()}`, name: "U", email: `${randomUUID()}@example.test` } });
const newDevice = (userId: string, data: { displayName?: string; lastSeenAt?: Date; revokedAt?: Date } = {}) =>
  prisma.device.create({ data: { userId, installationId: randomUUID(), displayName: "Windows Desktop", browser: "chrome", platform: "windows", ...data } });
const code = (promise: Promise<unknown>) => promise.then(() => "resolved", (error: { code?: string }) => error.code ?? "unknown");

describe("devices", () => {
  it("lists active devices by last seen, revoked last, without the installation id", async () => {
    const user = await newUser();
    const old = await newDevice(user.id, { displayName: "Old", lastSeenAt: new Date("2026-01-01T00:00:00Z") });
    const recent = await newDevice(user.id, { displayName: "Recent", lastSeenAt: new Date("2026-10-01T00:00:00Z") });
    const revoked = await newDevice(user.id, { displayName: "Revoked", lastSeenAt: new Date("2026-10-10T00:00:00Z"), revokedAt: new Date() });
    const { items } = await listDevices(prisma, user.id);
    expect(items.map((item) => item.id)).toEqual([recent.id, old.id, revoked.id]);
    expect(Object.keys(items[0]!).sort()).toEqual(["browser", "createdAt", "displayName", "id", "lastSeenAt", "platform", "revokedAt"]);
  });

  it("renames, and revokes once (credential version bumped once) even when repeated", async () => {
    const user = await newUser();
    const device = await newDevice(user.id);
    expect(await renameDevice(prisma, user.id, device.id, "Work laptop")).toMatchObject({ displayName: "Work laptop", revokedAt: null });
    const first = await revokeDevice(prisma, user.id, device.id);
    expect(first.revokedAt).not.toBeNull();
    const again = await revokeDevice(prisma, user.id, device.id);
    expect(again.revokedAt).toBe(first.revokedAt);
    const row = await prisma.device.findUniqueOrThrow({ where: { id: device.id } });
    expect(row.authCredentialVersion).toBe(2);
  });

  it("never touches another user's device", async () => {
    const [alice, bob] = [await newUser(), await newUser()];
    const device = await newDevice(alice.id);
    expect(await code(renameDevice(prisma, bob.id, device.id, "Pwned"))).toBe("NOT_FOUND");
    expect(await code(revokeDevice(prisma, bob.id, device.id))).toBe("NOT_FOUND");
    expect((await listDevices(prisma, bob.id)).items).toEqual([]);
    expect(await prisma.device.findUniqueOrThrow({ where: { id: device.id } })).toMatchObject({ displayName: "Windows Desktop", revokedAt: null, authCredentialVersion: 1 });
  });
});
