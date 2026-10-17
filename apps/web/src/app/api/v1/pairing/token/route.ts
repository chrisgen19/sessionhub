import { pairingTokenRequestSchema } from "@sessionhub/contracts/api-pairing";
import { getPrisma } from "@sessionhub/database/client";
import { handle, json, limitByIp, readJson } from "@/server/api/http";
import { redeemPairing } from "@/server/devices/pairing";

/** POST /api/v1/pairing/token { deviceCode }: 202 while pending, 200 with credentials once approved (once only). */
export const POST = handle(async (request: Request) => {
  limitByIp(request, "device-token");
  const { deviceCode } = await readJson(request, pairingTokenRequestSchema);
  const result = await redeemPairing(getPrisma(), deviceCode);
  return json(result, result.status === "pending" ? 202 : 200);
});
