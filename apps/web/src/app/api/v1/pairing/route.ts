import { startPairingRequestSchema } from "@sessionhub/contracts/api-pairing";
import { getPrisma } from "@sessionhub/database/client";
import { handle, json, limitByIp, readJson } from "@/server/api/http";
import { startPairing } from "@/server/devices/pairing";
import { getServerEnv } from "@/server/env";

/** POST /api/v1/pairing (extension, no account yet): start a pairing; 5 per IP, then 1 per minute. */
export const POST = handle(async (request: Request) => {
  await limitByIp(request, "pairing-start");
  const body = await readJson(request, startPairingRequestSchema);
  return json(await startPairing(getPrisma(), body, getServerEnv().BETTER_AUTH_URL), 201);
});
