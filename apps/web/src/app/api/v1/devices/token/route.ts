import { refreshCredentialRequestSchema } from "@sessionhub/contracts/api-pairing";
import { getPrisma } from "@sessionhub/database/client";
import { handle, json, limitByIp, readJson } from "@/server/api/http";
import { refreshCredential } from "@/server/devices/credentials";

/** POST /api/v1/devices/token { refreshToken }: rotate. Reusing an old refresh token revokes the device. */
export const POST = handle(async (request: Request) => {
  limitByIp(request, "device-token");
  const { refreshToken } = await readJson(request, refreshCredentialRequestSchema);
  return json(await refreshCredential(getPrisma(), refreshToken));
});
