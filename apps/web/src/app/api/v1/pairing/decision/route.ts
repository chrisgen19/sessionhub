import { decidePairingRequestSchema } from "@sessionhub/contracts/api-pairing";
import { getPrisma } from "@sessionhub/database/client";
import { authorizeWrite, handle, HttpError, json, readJson } from "@/server/api/http";
import { decidePairing } from "@/server/devices/pairing";
import { isMailEnabled } from "@/server/mail/deliver";

/**
 * POST /api/v1/pairing/decision { userCode, decision } from the signed-in web app (same-origin).
 * Approving needs a confirmed email whenever this server can send email.
 */
export const POST = handle(async (request: Request) => {
  const { userId, emailVerified } = await authorizeWrite(request);
  const { userCode, decision } = await readJson(request, decidePairingRequestSchema);
  if (decision === "approve" && !emailVerified && isMailEnabled()) {
    throw new HttpError(403, "EMAIL_NOT_CONFIRMED", "Confirm your email before connecting a browser.");
  }
  const device = await decidePairing(getPrisma(), userId, userCode, decision);
  return json(device ? { status: "approved", device } : { status: "denied" });
});
