import type { ConnectionRecord, DeviceRecord, SessionHubDb } from "./db";

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

/**
 * Whether this browser saved a session: its source is this installation, or this browser's device in
 * the connected account (what the server records for sessions this browser uploaded). Sessions from
 * other computers and imports (no source) aren't, so their window bounds never apply here: other
 * screens differ (docs/DATA_MODEL.md, SavedSessionWindow).
 */
export const savedOnThisBrowser = async (db: SessionHubDb, sourceDeviceId: string | null): Promise<boolean> => {
  if (!sourceDeviceId) return false;
  const [device, connection] = await Promise.all([getDevice(db), db.account.get("connection") as Promise<ConnectionRecord | undefined>]);
  return sourceDeviceId === device?.installationId || sourceDeviceId === connection?.deviceId;
};
