import { CREDENTIAL_LIFETIME, type DeviceCredentials } from "@sessionhub/contracts/api-pairing";
import type { PrismaClient } from "@sessionhub/database/client";
import { ServiceError } from "../service-errors";
import type { Tx } from "../sync/transaction";
import { revokeDevice } from "./service";
import { hashToken, newAccessToken, newRefreshToken } from "./tokens";

const SECOND = 1000;
/** lastSeenAt is a coarse "last API contact", written at most once a minute per device. */
const LAST_SEEN_PRECISION_MS = 60 * SECOND;

const invalid = () => new ServiceError("INVALID_TOKEN", "This device's sign-in is no longer valid. Connect it again.");
const revoked = () => new ServiceError("DEVICE_REVOKED", "This device was disconnected from the account. Connect it again to sync.");

/** Issues a new access/refresh pair bound to the device's current credential version. */
export const issueCredential = async (
  tx: Tx,
  device: { id: string; userId: string; authCredentialVersion: number },
  now = new Date(),
): Promise<{ id: string; credentials: DeviceCredentials }> => {
  const accessToken = newAccessToken();
  const refreshToken = newRefreshToken();
  const accessExpiresAt = new Date(now.getTime() + CREDENTIAL_LIFETIME.accessSeconds * SECOND);
  const refreshExpiresAt = new Date(now.getTime() + CREDENTIAL_LIFETIME.refreshSeconds * SECOND);
  const row = await tx.deviceCredential.create({
    data: {
      deviceId: device.id,
      userId: device.userId,
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      credentialVersion: device.authCredentialVersion,
      accessExpiresAt,
      refreshExpiresAt,
      createdAt: now,
    },
    select: { id: true },
  });
  // Housekeeping for this device only: expired pairs can never be used again.
  await tx.deviceCredential.deleteMany({ where: { deviceId: device.id, refreshExpiresAt: { lt: now } } });
  return { id: row.id, credentials: { accessToken, refreshToken, accessExpiresAt: accessExpiresAt.toISOString(), refreshExpiresAt: refreshExpiresAt.toISOString() } };
};

export interface DevicePrincipal {
  userId: string;
  deviceId: string;
}

/**
 * Checks an access token on every device request: known, not rotated away, not expired, and
 * the device is neither revoked nor re-paired since (credential version). Records last contact.
 */
export const authenticateAccessToken = async (prisma: PrismaClient, token: string, now = new Date()): Promise<DevicePrincipal> => {
  const credential = await prisma.deviceCredential.findUnique({
    where: { accessTokenHash: hashToken(token) },
    include: { device: { select: { revokedAt: true, authCredentialVersion: true, lastSeenAt: true } } },
  });
  if (!credential || credential.rotatedAt) throw invalid();
  if (credential.device.revokedAt || credential.device.authCredentialVersion !== credential.credentialVersion) throw revoked();
  if (credential.accessExpiresAt <= now) throw new ServiceError("ACCESS_TOKEN_EXPIRED", "The access token expired. Refresh it and retry.");
  if (!credential.usedAt) await prisma.deviceCredential.update({ where: { id: credential.id }, data: { usedAt: now } });
  if (!credential.device.lastSeenAt || now.getTime() - credential.device.lastSeenAt.getTime() > LAST_SEEN_PRECISION_MS) {
    await prisma.device.update({ where: { id: credential.deviceId }, data: { lastSeenAt: now } });
  }
  return { userId: credential.userId, deviceId: credential.deviceId };
};

type RefreshOutcome = { kind: "issued"; credentials: DeviceCredentials } | { kind: "reuse"; deviceId: string; userId: string };

const rotate = async (tx: Tx, refreshToken: string, now: Date): Promise<RefreshOutcome> => {
  const current = await tx.deviceCredential.findUnique({ where: { refreshTokenHash: hashToken(refreshToken) }, include: { device: true } });
  if (!current || current.refreshExpiresAt <= now) throw invalid();
  const { device } = current;
  if (device.revokedAt || device.authCredentialVersion !== current.credentialVersion) throw revoked();
  if (current.rotatedAt) {
    // Rotated already. Allowed once more only if its successor was never used (the client
    // lost the refresh response); anything else means two holders: treat as theft.
    const successor = current.replacedById ? await tx.deviceCredential.findUnique({ where: { id: current.replacedById } }) : null;
    if (!successor || successor.usedAt || successor.rotatedAt) return { kind: "reuse", deviceId: device.id, userId: device.userId };
    await tx.deviceCredential.update({ where: { id: successor.id }, data: { rotatedAt: now } });
  }
  const next = await issueCredential(tx, device, now);
  const { count } = await tx.deviceCredential.updateMany({
    where: { id: current.id, OR: [{ rotatedAt: null }, { replacedById: current.replacedById }] },
    data: { rotatedAt: now, replacedById: next.id, usedAt: current.usedAt ?? now },
  });
  if (count !== 1) throw invalid();
  return { kind: "issued", credentials: next.credentials };
};

/**
 * Exchanges a refresh token for a new pair (rotation). Reuse of an old refresh token revokes
 * the device: the revoke is committed before the error is returned.
 */
export const refreshCredential = async (prisma: PrismaClient, refreshToken: string, now = new Date()): Promise<DeviceCredentials> => {
  const outcome = await prisma.$transaction((tx) => rotate(tx, refreshToken, now));
  if (outcome.kind === "issued") return outcome.credentials;
  await revokeDevice(prisma, outcome.userId, outcome.deviceId, "refresh-reuse");
  throw revoked();
};
