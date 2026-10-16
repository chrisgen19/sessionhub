import { pushRequestSchema, SYNC_PROTOCOL_VERSION } from "@sessionhub/contracts/api-sync";
import { getPrisma } from "@sessionhub/database/client";
import { authenticateDevice, chargeWrites, handle, HttpError, json, readJson } from "@/server/api/http";
import { isMailEnabled } from "@/server/mail/deliver";
import { hasRepeatedEntity, loadPusher, pushOperations } from "@/server/sync/push";

/**
 * POST /api/v1/sync/push (Bearer): uploads a batch of the extension's queued changes and answers
 * with one result per operation (docs/SYNC_PROTOCOL.md 13f). Each operation costs one write from
 * the account's shared budget, charged after the body is read and checked.
 */
export const POST = handle(async (request: Request) => {
  const device = await authenticateDevice(request);
  const body = await readJson(request, pushRequestSchema);
  if (body.deviceId !== device.deviceId) {
    throw new HttpError(403, "DEVICE_MISMATCH", "This push names a different device than its access token.");
  }
  if (hasRepeatedEntity(body.operations)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Send at most one operation per session in one push.");
  }
  const { pusher, emailVerified } = await loadPusher(getPrisma(), device);
  if (!emailVerified && isMailEnabled()) {
    throw new HttpError(403, "EMAIL_NOT_CONFIRMED", "Confirm your email to sync this browser.");
  }
  chargeWrites(device.userId, body.operations.length);
  return json({ protocolVersion: SYNC_PROTOCOL_VERSION, results: await pushOperations(getPrisma(), pusher, body.operations) });
});
