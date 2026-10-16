import type { DeviceRecord, SessionHubDb } from "./db";

export const DEFAULT_DEVICE_NAME = "This browser";

/**
 * Returns this installation's persistent identity, creating it on first use.
 * The installation id is an app UUID, never a browser runtime id.
 */
export const getOrCreateDevice = (db: SessionHubDb, createId: () => string, now: Date): Promise<DeviceRecord> =>
  db.transaction("rw", db.device, async () => {
    const existing = await db.device.get("this-device");
    if (existing) return existing;
    const device: DeviceRecord = {
      key: "this-device",
      installationId: createId(),
      friendlyName: DEFAULT_DEVICE_NAME,
      createdAt: now.toISOString(),
    };
    await db.device.add(device);
    return device;
  });

export const getDevice = (db: SessionHubDb): Promise<DeviceRecord | undefined> => db.device.get("this-device");
