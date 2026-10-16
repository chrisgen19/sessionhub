import { getPrisma } from "@sessionhub/database/client";
import { authenticate, handle, json } from "@/server/api/http";
import { listDevices } from "@/server/devices/service";

/** GET /api/v1/devices: the account's devices, active first, revoked ones included. */
export const GET = handle(async (request: Request) => {
  const { userId } = await authenticate(request);
  return json(await listDevices(getPrisma(), userId));
});
