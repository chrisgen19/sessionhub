import { formatUserCode, PAIRING, type PairingTokenResponse, type StartPairingRequest, type StartPairingResponse } from "@sessionhub/contracts/api-pairing";
import type { Prisma, PrismaClient } from "@sessionhub/database/client";
import { ServiceError } from "../service-errors";
import type { Tx } from "../sync/transaction";
import { issueCredential } from "./credentials";
import { toDevice } from "./service";
import { hashToken, newDeviceCode, newUserCode } from "./tokens";

const SECOND = 1000;
const expired = () => new ServiceError("PAIRING_EXPIRED", "This connection request expired or was already used. Start again from the extension.");
const unknownCode = () => new ServiceError("NOT_FOUND", "No connection request with that code. Check the code in the extension, or start again.");

/** Creates a pending pairing. The device code is returned once and only its hash is kept. */
export const startPairing = async (prisma: PrismaClient, input: StartPairingRequest, appOrigin: string, now = new Date()): Promise<StartPairingResponse> => {
  // Requests older than a day are never redeemable; drop them as new ones arrive.
  await prisma.devicePairing.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400 * SECOND) } } });
  const deviceCode = newDeviceCode();
  for (let attempt = 0; ; attempt += 1) {
    const userCode = newUserCode();
    try {
      await prisma.devicePairing.create({
        data: { ...input, deviceCodeHash: hashToken(deviceCode), userCode, createdAt: now, expiresAt: new Date(now.getTime() + PAIRING.expiresInSeconds * SECOND) },
      });
      const verificationUri = new URL("/app/pair", appOrigin).toString();
      return {
        deviceCode,
        userCode: formatUserCode(userCode),
        verificationUri,
        verificationUriComplete: `${verificationUri}?code=${formatUserCode(userCode)}`,
        expiresIn: PAIRING.expiresInSeconds,
        interval: PAIRING.intervalSeconds,
      };
    } catch (error) {
      // A user-code collision (unique index) is astronomically rare; retry with a new code.
      if ((error as { code?: unknown }).code !== "P2002" || attempt >= 2) throw error;
    }
  }
};

export interface PendingPairing {
  userCode: string;
  deviceName: string;
  browser: string | null;
  platform: string | null;
  createdAt: Date;
  expiresAt: Date;
}

/** What the approve page shows for a code: only pending, unexpired requests. */
export const findPendingPairing = async (prisma: PrismaClient, userCode: string, now = new Date()): Promise<PendingPairing | null> => {
  const row = await prisma.devicePairing.findUnique({ where: { userCode } });
  if (!row || row.status !== "pending" || row.expiresAt <= now) return null;
  return { userCode: formatUserCode(row.userCode), deviceName: row.deviceName, browser: row.browser, platform: row.platform, createdAt: row.createdAt, expiresAt: row.expiresAt };
};

type PairingRow = Prisma.DevicePairingGetPayload<object>;

/**
 * One Device per (account, installation). Pairing again (e.g. after a revoke) reuses the row,
 * clears the revocation and bumps the credential version, so every older credential dies.
 */
const upsertDevice = (tx: Tx, userId: string, pairing: PairingRow, now: Date) =>
  tx.device.upsert({
    where: { userId_installationId: { userId, installationId: pairing.installationId } },
    create: { userId, installationId: pairing.installationId, displayName: pairing.deviceName, browser: pairing.browser, platform: pairing.platform, lastSeenAt: now },
    update: { revokedAt: null, authCredentialVersion: { increment: 1 }, browser: pairing.browser, platform: pairing.platform, lastSeenAt: now },
  });

/** Approve or deny a pending pairing as the signed-in user (cookie session, same-origin). */
export const decidePairing = (prisma: PrismaClient, userId: string, userCode: string, decision: "approve" | "deny", now = new Date()) =>
  prisma.$transaction(async (tx) => {
    const pairing = await tx.devicePairing.findUnique({ where: { userCode } });
    if (!pairing || pairing.status !== "pending" || pairing.expiresAt <= now) throw unknownCode();
    const device = decision === "approve" ? await upsertDevice(tx, userId, pairing, now) : null;
    const { count } = await tx.devicePairing.updateMany({
      where: { id: pairing.id, status: "pending" },
      data: { status: decision === "approve" ? "approved" : "denied", userId, deviceId: device?.id ?? null, decidedAt: now },
    });
    if (count !== 1) throw unknownCode();
    if (device) await tx.auditEvent.create({ data: { userId, kind: "device_paired", deviceId: device.id, metadata: {} } });
    return device ? toDevice(device) : null;
  });

/**
 * The extension's poll. Pending -> 202-style answer; approved -> credentials exactly once.
 * Polling faster than the interval is answered with RATE_LIMITED (RFC 8628 "slow_down").
 */
export const redeemPairing = async (prisma: PrismaClient, deviceCode: string, now = new Date()): Promise<PairingTokenResponse> => {
  const pairing = await prisma.devicePairing.findUnique({ where: { deviceCodeHash: hashToken(deviceCode) } });
  if (!pairing) throw expired();
  if (pairing.status === "denied") throw new ServiceError("PAIRING_DENIED", "The connection was declined on the website.");
  if (pairing.status === "redeemed" || pairing.expiresAt <= now) throw expired();
  if (pairing.lastPolledAt && now.getTime() - pairing.lastPolledAt.getTime() < (PAIRING.intervalSeconds - 1) * SECOND) {
    throw new ServiceError("RATE_LIMITED", "Polling too fast.", { retryAfterSeconds: PAIRING.intervalSeconds });
  }
  await prisma.devicePairing.update({ where: { id: pairing.id }, data: { lastPolledAt: now } });
  if (pairing.status === "pending") return { status: "pending", interval: PAIRING.intervalSeconds };
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.devicePairing.updateMany({ where: { id: pairing.id, status: "approved" }, data: { status: "redeemed" } });
    if (count !== 1 || !pairing.deviceId || !pairing.userId) throw expired();
    const device = await tx.device.findFirst({ where: { id: pairing.deviceId, userId: pairing.userId }, include: { user: { select: { name: true, email: true } } } });
    if (!device || device.revokedAt) throw expired();
    const { credentials } = await issueCredential(tx, device, now);
    return { status: "approved", credentials, device: toDevice(device), account: { id: device.userId, name: device.user.name, email: device.user.email } };
  });
};
