import { renameDeviceRequestSchema } from "@sessionhub/contracts/api-devices";
import { getPrisma } from "@sessionhub/database/client";
import { authorizeWrite, handle, idOrNotFound, json, readJson } from "@/server/api/http";
import { renameDevice } from "@/server/devices/service";

type Context = RouteContext<"/api/v1/devices/[id]">;

/** PATCH { displayName }: rename. Another user's device is a 404. */
export const PATCH = handle(async (request: Request, context: Context) => {
  const { userId } = await authorizeWrite(request);
  const id = idOrNotFound((await context.params).id, "Device");
  const { displayName } = await readJson(request, renameDeviceRequestSchema);
  return json(await renameDevice(getPrisma(), userId, id, displayName));
});
