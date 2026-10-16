import { randomUUID } from "node:crypto";
import { normalizeUserCode, startPairingRequestSchema } from "@sessionhub/contracts/api-pairing";
import { getPrisma } from "@sessionhub/database/client";
import { afterAll, describe, expect, it } from "vitest";
import { authenticateAccessToken, refreshCredential } from "./credentials";
import { decidePairing, findPendingPairing, redeemPairing, startPairing } from "./pairing";
import { revokeDevice } from "./service";

const prisma = getPrisma();
afterAll(async () => {
  await prisma.$disconnect();
});

const ORIGIN = "http://localhost:3000";
const newUser = () => prisma.user.create({ data: { id: `user_${randomUUID()}`, name: "Pat", email: `${randomUUID()}@example.test` } });
const code = (promise: Promise<unknown>) => promise.then(() => "resolved", (error: { code?: string }) => error.code ?? String(error));
const at = (base: Date, seconds: number) => new Date(base.getTime() + seconds * 1000);
const request = (installationId = randomUUID()) => startPairingRequestSchema.parse({ installationId, deviceName: "Chrome on Windows", browser: "Chrome", platform: "Windows" });

/** Start -> approve -> redeem, returning the issued credentials. */
const pairDevice = async (userId: string, installationId = randomUUID(), now = new Date()) => {
  const started = await startPairing(prisma, request(installationId), ORIGIN, now);
  await decidePairing(prisma, userId, normalizeUserCode(started.userCode), "approve", at(now, 1));
  const redeemed = await redeemPairing(prisma, started.deviceCode, at(now, 6));
  if (redeemed.status !== "approved") throw new Error("not approved");
  return { ...redeemed, started };
};

describe("pairing", () => {
  it("starts with a formatted code and app links, then redeems exactly once", async () => {
    const user = await newUser();
    const now = new Date();
    const started = await startPairing(prisma, request(), ORIGIN, now);
    expect(started).toMatchObject({ expiresIn: 600, interval: 5, verificationUri: `${ORIGIN}/app/pair` });
    expect(started.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(started.verificationUriComplete).toBe(`${ORIGIN}/app/pair?code=${started.userCode}`);
    expect(started.deviceCode).toMatch(/^shd_dc_[A-Za-z0-9_-]{43}$/);
    // Only the hash is stored.
    expect(await prisma.devicePairing.count({ where: { deviceCodeHash: started.deviceCode } })).toBe(0);

    const userCode = normalizeUserCode(started.userCode);
    expect(await findPendingPairing(prisma, userCode, at(now, 1))).toMatchObject({ deviceName: "Chrome on Windows", userCode: started.userCode });
    expect(await redeemPairing(prisma, started.deviceCode, at(now, 1))).toEqual({ status: "pending", interval: 5 });
    expect(await code(redeemPairing(prisma, started.deviceCode, at(now, 2)))).toBe("RATE_LIMITED");

    const device = await decidePairing(prisma, user.id, userCode, "approve", at(now, 3));
    expect(device).toMatchObject({ displayName: "Chrome on Windows", browser: "Chrome", platform: "Windows", revokedAt: null });
    expect(await findPendingPairing(prisma, userCode, at(now, 4))).toBeNull();
    const redeemed = await redeemPairing(prisma, started.deviceCode, at(now, 7));
    expect(redeemed).toMatchObject({ status: "approved", device: { id: device?.id }, account: { name: "Pat", email: user.email } });
    expect(await code(redeemPairing(prisma, started.deviceCode, at(now, 13)))).toBe("PAIRING_EXPIRED");
  });

  it("refuses expired, declined and already-decided requests", async () => {
    const [user, other] = [await newUser(), await newUser()];
    const now = new Date();
    const late = await startPairing(prisma, request(), ORIGIN, now);
    expect(await code(decidePairing(prisma, user.id, normalizeUserCode(late.userCode), "approve", at(now, 601)))).toBe("NOT_FOUND");
    expect(await code(redeemPairing(prisma, late.deviceCode, at(now, 601)))).toBe("PAIRING_EXPIRED");

    const declined = await startPairing(prisma, request(), ORIGIN, now);
    expect(await decidePairing(prisma, user.id, normalizeUserCode(declined.userCode), "deny", at(now, 1))).toBeNull();
    expect(await code(decidePairing(prisma, other.id, normalizeUserCode(declined.userCode), "approve", at(now, 2)))).toBe("NOT_FOUND");
    expect(await code(redeemPairing(prisma, declined.deviceCode, at(now, 6)))).toBe("PAIRING_DENIED");
    expect(await prisma.device.count({ where: { userId: { in: [user.id, other.id] } } })).toBe(0);
    expect(await code(redeemPairing(prisma, `shd_dc_${"A".repeat(43)}`, now))).toBe("PAIRING_EXPIRED");
  });
});

describe("device credentials", () => {
  it("authenticates on every request, records last contact and expires after 15 minutes", async () => {
    const user = await newUser();
    const now = new Date();
    const { credentials, device } = await pairDevice(user.id, randomUUID(), now);
    expect(credentials.accessToken).toMatch(/^shd_at_/);
    expect(credentials.refreshToken).toMatch(/^shd_rt_/);
    expect(new Date(credentials.accessExpiresAt).getTime() - at(now, 6).getTime()).toBe(15 * 60 * 1000);
    expect(await prisma.deviceCredential.count({ where: { OR: [{ accessTokenHash: credentials.accessToken }, { refreshTokenHash: credentials.refreshToken }] } })).toBe(0);

    expect(await authenticateAccessToken(prisma, credentials.accessToken, at(now, 120))).toEqual({ userId: user.id, deviceId: device.id });
    expect((await prisma.device.findUniqueOrThrow({ where: { id: device.id } })).lastSeenAt).toEqual(at(now, 120));
    expect(await code(authenticateAccessToken(prisma, credentials.accessToken, at(now, 6 + 15 * 60)))).toBe("ACCESS_TOKEN_EXPIRED");
    expect(await code(authenticateAccessToken(prisma, `shd_at_${"B".repeat(43)}`, now))).toBe("INVALID_TOKEN");
  });

  it("stops working immediately after a revoke, and pairing again issues fresh credentials", async () => {
    const user = await newUser();
    const installationId = randomUUID();
    const first = await pairDevice(user.id, installationId);
    await revokeDevice(prisma, user.id, first.device.id);
    expect(await code(authenticateAccessToken(prisma, first.credentials.accessToken))).toBe("DEVICE_REVOKED");
    expect(await code(refreshCredential(prisma, first.credentials.refreshToken))).toBe("DEVICE_REVOKED");

    const second = await pairDevice(user.id, installationId);
    expect(second.device.id).toBe(first.device.id);
    expect(second.device.revokedAt).toBeNull();
    expect(await authenticateAccessToken(prisma, second.credentials.accessToken)).toMatchObject({ deviceId: first.device.id });
    expect(await code(authenticateAccessToken(prisma, first.credentials.accessToken))).toBe("DEVICE_REVOKED");
  });

  it("rotates on refresh: old tokens die, the new pair works", async () => {
    const user = await newUser();
    const { credentials } = await pairDevice(user.id);
    const next = await refreshCredential(prisma, credentials.refreshToken);
    expect(next.refreshToken).not.toBe(credentials.refreshToken);
    expect(await code(authenticateAccessToken(prisma, credentials.accessToken))).toBe("INVALID_TOKEN");
    expect(await authenticateAccessToken(prisma, next.accessToken)).toMatchObject({ userId: user.id });
    const third = await refreshCredential(prisma, next.refreshToken);
    expect(await authenticateAccessToken(prisma, third.accessToken)).toMatchObject({ userId: user.id });
  });

  it("allows one retry with the previous refresh token while its replacement is unused (lost response)", async () => {
    const user = await newUser();
    const { credentials, device } = await pairDevice(user.id);
    const lost = await refreshCredential(prisma, credentials.refreshToken);
    const retried = await refreshCredential(prisma, credentials.refreshToken);
    expect(await code(authenticateAccessToken(prisma, lost.accessToken))).toBe("INVALID_TOKEN");
    expect(await code(refreshCredential(prisma, lost.refreshToken))).toBe("DEVICE_REVOKED");
    // Using the lost pair after the retry is theft-like: the device is now revoked.
    expect((await prisma.device.findUniqueOrThrow({ where: { id: device.id } })).revokedAt).not.toBeNull();
    expect(await code(authenticateAccessToken(prisma, retried.accessToken))).toBe("DEVICE_REVOKED");
  });

  it("revokes the device when an old refresh token is reused after the new one was used", async () => {
    const user = await newUser();
    const { credentials, device } = await pairDevice(user.id);
    const next = await refreshCredential(prisma, credentials.refreshToken);
    await authenticateAccessToken(prisma, next.accessToken);
    expect(await code(refreshCredential(prisma, credentials.refreshToken))).toBe("DEVICE_REVOKED");
    const row = await prisma.device.findUniqueOrThrow({ where: { id: device.id } });
    expect(row.revokedAt).not.toBeNull();
    expect(row.authCredentialVersion).toBe(2);
    const events = await prisma.auditEvent.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((event) => [event.kind, event.metadata])).toEqual([["device_paired", {}], ["device_revoked", { reason: "refresh-reuse" }]]);
    expect(await code(authenticateAccessToken(prisma, next.accessToken))).toBe("DEVICE_REVOKED");
  });

  it("keeps accounts apart: the same installation paired to two accounts is two devices", async () => {
    const [alice, bob] = [await newUser(), await newUser()];
    const installationId = randomUUID();
    const a = await pairDevice(alice.id, installationId);
    const b = await pairDevice(bob.id, installationId);
    expect(a.device.id).not.toBe(b.device.id);
    expect(await authenticateAccessToken(prisma, b.credentials.accessToken)).toEqual({ userId: bob.id, deviceId: b.device.id });
    expect(await code(revokeDevice(prisma, bob.id, a.device.id))).toBe("NOT_FOUND");
  });
});
