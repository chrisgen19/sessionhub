import { bootstrapQuerySchema } from "@sessionhub/contracts/api-sync";
import { getPrisma } from "@sessionhub/database/client";
import { handle, json, parseOrThrow } from "@/server/api/http";
import { authorizeSyncRead } from "@/server/sync/device-reader";
import { bootstrapPage } from "@/server/sync/pull";

/** GET /api/v1/sync/bootstrap?after=&limit= (Bearer): the account's current sessions, for a client without a usable cursor. */
export const GET = handle(async (request: Request) => {
  const { userId } = await authorizeSyncRead(getPrisma(), request);
  const { after, limit } = parseOrThrow(bootstrapQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
  return json(await bootstrapPage(getPrisma(), userId, after, limit));
});
