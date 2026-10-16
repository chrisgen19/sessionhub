import { pullQuerySchema } from "@sessionhub/contracts/api-sync";
import { getPrisma } from "@sessionhub/database/client";
import { handle, json, parseOrThrow } from "@/server/api/http";
import { authorizeSyncRead } from "@/server/sync/device-reader";
import { pullPage } from "@/server/sync/pull";

/** GET /api/v1/sync/pull?cursor=&limit= (Bearer): the account's ordered changes after a cursor (docs/SYNC_PROTOCOL.md 13g). */
export const GET = handle(async (request: Request) => {
  const { userId } = await authorizeSyncRead(getPrisma(), request);
  const { cursor, limit } = parseOrThrow(pullQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
  return json(await pullPage(getPrisma(), userId, cursor, limit));
});
