import { createHash, randomBytes, randomInt } from "node:crypto";
import { PAIRING } from "@sessionhub/contracts/api-pairing";

/** Prefixes make leaked tokens recognizable (log review, secret scanners). 32 random bytes each. */
const PREFIX = { deviceCode: "shd_dc_", access: "shd_at_", refresh: "shd_rt_" } as const;

const secret = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;

export const newDeviceCode = () => secret(PREFIX.deviceCode);
export const newAccessToken = () => secret(PREFIX.access);
export const newRefreshToken = () => secret(PREFIX.refresh);

/** Tokens are high-entropy, so a fast hash is enough; only hashes are stored. */
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** 8 characters from a 20-letter alphabet (about 2.6e10 combinations), unbiased. */
export const newUserCode = (): string =>
  Array.from({ length: PAIRING.userCodeLength }, () => PAIRING.userCodeAlphabet[randomInt(PAIRING.userCodeAlphabet.length)]).join("");

/** `Authorization: Bearer shd_at_...`, or null when absent or another scheme. */
export const bearerToken = (request: Request): string | null => {
  const match = /^Bearer (shd_at_[A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
};
