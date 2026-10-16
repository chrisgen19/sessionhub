import { getPrisma } from "@sessionhub/database/client";
import { authenticateDevice, handle, json } from "@/server/api/http";
import { getDeviceWithAccount } from "@/server/devices/service";

/** GET /api/v1/devices/me (Bearer): this device and the account it's connected to. */
export const GET = handle(async (request: Request) => {
  const { userId, deviceId } = await authenticateDevice(request);
  return json(await getDeviceWithAccount(getPrisma(), userId, deviceId));
});
