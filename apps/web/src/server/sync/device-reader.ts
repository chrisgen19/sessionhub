import type { PrismaClient } from "@sessionhub/database/client";
import { authenticateDevice, chargeRead, HttpError } from "@/server/api/http";
import type { DevicePrincipal } from "@/server/devices/credentials";
import { isMailEnabled } from "@/server/mail/deliver";
import { loadPusher } from "./push";

/** Gate for sync reads: a device Bearer token, the account's read budget and, when this server sends email, a confirmed email. */
export const authorizeSyncRead = async (prisma: PrismaClient, request: Request): Promise<DevicePrincipal> => {
  const device = await authenticateDevice(request);
  await chargeRead(device.userId);
  const { emailVerified } = await loadPusher(prisma, device);
  if (!emailVerified && isMailEnabled()) throw new HttpError(403, "EMAIL_NOT_CONFIRMED", "Confirm your email to sync this browser.");
  return device;
};
