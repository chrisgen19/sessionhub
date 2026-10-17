import { DEVICE_LIMITS, type ApiDevice, type ListDevicesResponse } from "@sessionhub/contracts/api-devices";
import type { DeviceMeResponse } from "@sessionhub/contracts/api-pairing";
import type { Prisma, PrismaClient } from "@sessionhub/database/client";
import { ServiceError } from "../service-errors";

const deviceFields = {
  id: true,
  displayName: true,
  browser: true,
  platform: true,
  createdAt: true,
  lastSeenAt: true,
  revokedAt: true,
} satisfies Prisma.DeviceSelect;

type DeviceRow = Prisma.DeviceGetPayload<{ select: typeof deviceFields }>;

export const toDevice = (row: DeviceRow): ApiDevice => ({
  id: row.id,
  displayName: row.displayName,
  browser: row.browser,
  platform: row.platform,
  createdAt: row.createdAt.toISOString(),
  lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null,
});

const notFound = () => new ServiceError("NOT_FOUND", "Device not found.");

/** Active devices first (most recently seen first), then revoked ones. */
export const listDevices = async (prisma: PrismaClient, userId: string): Promise<ListDevicesResponse> => {
  const rows = await prisma.device.findMany({
    where: { userId },
    orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { lastSeenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }],
    take: DEVICE_LIMITS.perUserListMax,
    select: deviceFields,
  });
  return { items: rows.map(toDevice) };
};

/** A label only: never used for access decisions. Revoked devices can still be renamed. */
export const renameDevice = async (prisma: PrismaClient, userId: string, id: string, displayName: string): Promise<ApiDevice> => {
  const { count } = await prisma.device.updateMany({ where: { id, userId }, data: { displayName } });
  if (count === 0) throw notFound();
  return toDevice(await prisma.device.findUniqueOrThrow({ where: { id }, select: deviceFields }));
};

export type RevokeReason = "web" | "extension" | "refresh-reuse";

/**
 * Revokes a device: sets revoked_at once and bumps auth_credential_version so every credential
 * issued to it stops working, and records an audit event. Repeating it changes nothing.
 */
export const revokeDevice = async (prisma: PrismaClient, userId: string, id: string, reason: RevokeReason = "web"): Promise<ApiDevice> =>
  prisma.$transaction(async (tx) => {
    const { count } = await tx.device.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date(), authCredentialVersion: { increment: 1 } },
    });
    if (count === 1) await tx.auditEvent.create({ data: { userId, kind: "device_revoked", deviceId: id, metadata: { reason } } });
    const row = await tx.device.findFirst({ where: { id, userId }, select: deviceFields });
    if (!row) throw notFound();
    return toDevice(row);
  });

/** The calling device and its account, for the extension's "Connected as" view. */
export const getDeviceWithAccount = async (prisma: PrismaClient, userId: string, deviceId: string): Promise<DeviceMeResponse> => {
  const row = await prisma.device.findFirst({ where: { id: deviceId, userId }, select: { ...deviceFields, user: { select: { name: true, email: true } } } });
  if (!row) throw notFound();
  const { user, ...device } = row;
  return { device: toDevice(device), account: user };
};
