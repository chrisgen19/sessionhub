import { DEVICE_LIMITS, type ApiDevice, type ListDevicesResponse } from "@sessionhub/contracts/api-devices";
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

const toDevice = (row: DeviceRow): ApiDevice => ({
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

/**
 * Revokes a device: sets revoked_at once and bumps auth_credential_version so any credential
 * issued to it (M4 pairing) stops working. Repeating it changes nothing and returns the device.
 */
export const revokeDevice = async (prisma: PrismaClient, userId: string, id: string): Promise<ApiDevice> =>
  prisma.$transaction(async (tx) => {
    await tx.device.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date(), authCredentialVersion: { increment: 1 } },
    });
    const row = await tx.device.findFirst({ where: { id, userId }, select: deviceFields });
    if (!row) throw notFound();
    return toDevice(row);
  });
