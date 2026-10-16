import { getPrisma } from "@sessionhub/database/client";
import { authorizeWrite, handle, idOrNotFound, json } from "@/server/api/http";
import { revokeDevice } from "@/server/devices/service";

type Context = RouteContext<"/api/v1/devices/[id]/revoke">;

/** POST (no body): revoke the device's credentials. Idempotent; another user's device is a 404. */
export const POST = handle(async (request: Request, context: Context) => {
  const { userId } = await authorizeWrite(request);
  const id = idOrNotFound((await context.params).id, "Device");
  return json(await revokeDevice(getPrisma(), userId, id));
});
