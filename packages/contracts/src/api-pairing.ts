import { z } from "zod";
import { apiDeviceSchema } from "./api-devices";

/**
 * Extension pairing (RFC 8628-style device flow) and device credentials
 * (docs/SECURITY_PRIVACY.md section 5a, docs/SYNC_PROTOCOL.md section 13d).
 */

export const PAIRING = {
  /** Seconds a pairing request stays valid (start -> approve -> redeem). */
  expiresInSeconds: 600,
  /** Minimum seconds between two token polls for one pairing. */
  intervalSeconds: 5,
  /** RFC 8628 section 6.1 alphabet: consonants only, so codes can't spell words or be misread. */
  userCodeAlphabet: "BCDFGHJKLMNPQRSTVWXZ",
  userCodeLength: 8,
} as const;

export const CREDENTIAL_LIFETIME = {
  accessSeconds: 15 * 60,
  refreshSeconds: 30 * 24 * 60 * 60,
} as const;

const label = (max: number) => z.string().trim().regex(/^[\p{L}\p{N} ._()-]*$/u, "Use letters, numbers and simple punctuation").max(max);

export const startPairingRequestSchema = z.strictObject({
  installationId: z.uuid(),
  deviceName: label(120).min(1),
  browser: label(40).nullable().default(null),
  platform: label(40).nullable().default(null),
});
export type StartPairingRequest = z.infer<typeof startPairingRequestSchema>;

export const startPairingResponseSchema = z.object({
  /** Secret held only by the extension; redeemed once for credentials. */
  deviceCode: z.string(),
  /** Shown in the extension and on the approve page, formatted `XXXX-XXXX`. */
  userCode: z.string(),
  verificationUri: z.url(),
  verificationUriComplete: z.url(),
  expiresIn: z.int().positive(),
  interval: z.int().positive(),
});
export type StartPairingResponse = z.infer<typeof startPairingResponseSchema>;

export const deviceCodeSchema = z.string().regex(/^shd_dc_[A-Za-z0-9_-]{43}$/, "Invalid device code");
export const refreshTokenSchema = z.string().regex(/^shd_rt_[A-Za-z0-9_-]{43}$/, "Invalid refresh token");

export const pairingTokenRequestSchema = z.strictObject({ deviceCode: deviceCodeSchema });
export const refreshCredentialRequestSchema = z.strictObject({ refreshToken: refreshTokenSchema });

/** User codes are compared case-insensitively, ignoring spaces and dashes. */
export const normalizeUserCode = (value: string): string => value.toUpperCase().replace(/[\s-]/g, "");
export const formatUserCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

export const userCodeSchema = z
  .string()
  .max(32)
  .transform(normalizeUserCode)
  .pipe(z.string().regex(new RegExp(`^[${PAIRING.userCodeAlphabet}]{${PAIRING.userCodeLength}}$`), "Check the code shown in the extension"));

export const decidePairingRequestSchema = z.strictObject({ userCode: userCodeSchema, decision: z.enum(["approve", "deny"]) });
export type DecidePairingRequest = z.infer<typeof decidePairingRequestSchema>;

export const deviceCredentialsSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: z.iso.datetime(),
  refreshExpiresAt: z.iso.datetime(),
});
export type DeviceCredentials = z.infer<typeof deviceCredentialsSchema>;

export const pairedAccountSchema = z.object({ name: z.string(), email: z.string() });

export const pairingTokenResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending"), interval: z.int().positive() }),
  z.object({ status: z.literal("approved"), credentials: deviceCredentialsSchema, device: apiDeviceSchema, account: pairedAccountSchema }),
]);
export type PairingTokenResponse = z.infer<typeof pairingTokenResponseSchema>;

export const deviceMeResponseSchema = z.object({ device: apiDeviceSchema, account: pairedAccountSchema });
export type DeviceMeResponse = z.infer<typeof deviceMeResponseSchema>;
