import { getPrisma } from "@sessionhub/database/client";
import { authorizeDeviceWrite, handle, json } from "@/server/api/http";
import { revokeDevice } from "@/server/devices/service";

/** POST /api/v1/devices/me/disconnect (Bearer): the extension revokes its own credentials. */
export const POST = handle(async (request: Request) => {
  const { userId, deviceId } = await authorizeDeviceWrite(request);
  return json(await revokeDevice(getPrisma(), userId, deviceId, "extension"));
});
