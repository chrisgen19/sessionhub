import { z } from "zod";

/**
 * /api/v1/devices contracts (docs/SYNC_PROTOCOL.md section 13c). Registration (POST
 * /api/v1/devices) belongs to extension pairing in M4. The installation id is not exposed.
 */

export const DEVICE_LIMITS = { displayNameMax: 120, perUserListMax: 200 } as const;

export const renameDeviceRequestSchema = z.strictObject({
  displayName: z.string().trim().min(1, "Enter a name").max(DEVICE_LIMITS.displayNameMax),
});
export type RenameDeviceRequest = z.infer<typeof renameDeviceRequestSchema>;

export const apiDeviceSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  browser: z.string().nullable(),
  platform: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Last API contact. Not "online": a device can be idle or closed long after this. */
  lastSeenAt: z.iso.datetime().nullable(),
  /** Set once revoked; a revoked device can't use the API again (it must pair anew). */
  revokedAt: z.iso.datetime().nullable(),
});
export type ApiDevice = z.infer<typeof apiDeviceSchema>;

export const listDevicesResponseSchema = z.object({ items: z.array(apiDeviceSchema) });
export type ListDevicesResponse = z.infer<typeof listDevicesResponseSchema>;
