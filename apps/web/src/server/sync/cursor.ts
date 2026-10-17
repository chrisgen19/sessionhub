import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "../env";
import { ServiceError } from "../service-errors";

/**
 * Pull cursors: `c1.<sequence>.<mac>`, with an HMAC over (user id, sequence) under a key derived
 * from BETTER_AUTH_SECRET. Another account's cursor or an edited one is refused, which catches a
 * client mixing accounts. Never authorization: every query is still scoped to the authenticated
 * user. Rotating the secret invalidates all cursors; clients then bootstrap.
 */

const PATTERN = /^c1\.(0|[1-9]\d{0,18})\.([A-Za-z0-9_-]{22})$/;

const key = () => createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update("sessionhub/sync-cursor/v1").digest();
const mac = (userId: string, sequence: bigint) => createHmac("sha256", key()).update(`${userId}:${sequence}`).digest("base64url").slice(0, 22);

export const encodeSyncCursor = (userId: string, sequence: bigint): string => `c1.${sequence}.${mac(userId, sequence)}`;

const invalid = () => new ServiceError("INVALID_CURSOR", "That sync cursor isn't valid for this account. Rebuild from a full copy.");

/** The last sequence a cursor covers. */
export const decodeSyncCursor = (userId: string, cursor: string): bigint => {
  const [, digits, signature] = PATTERN.exec(cursor) ?? [];
  if (!digits || !signature) throw invalid();
  const sequence = BigInt(digits);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(mac(userId, sequence)))) throw invalid();
  return sequence;
};
