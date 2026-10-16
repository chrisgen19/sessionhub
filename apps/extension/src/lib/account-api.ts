import {
  deviceCredentialsSchema,
  deviceMeResponseSchema,
  pairingTokenResponseSchema,
  startPairingResponseSchema,
  type DeviceCredentials,
  type DeviceMeResponse,
  type PairingTokenResponse,
  type StartPairingRequest,
  type StartPairingResponse,
} from "@sessionhub/contracts/api-pairing";
import { apiErrorResponseSchema, type ApiErrorCode } from "@sessionhub/contracts/api-sessions";
import type { z } from "zod";

/** A failed call to the SessionHub server, with the API error code when there is one. */
export class AccountApiError extends Error {
  override name = "AccountApiError";
  constructor(
    readonly code: ApiErrorCode | "NETWORK",
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export type Fetch = typeof fetch;
const TIMEOUT_MS = 15_000;

/** One JSON request; server responses are validated, never trusted as-is. */
const call = async <T extends z.ZodType>(
  fetchImpl: Fetch,
  origin: string,
  path: string,
  schema: T,
  init: { method: "GET" | "POST"; body?: unknown; accessToken?: string },
): Promise<z.infer<T>> => {
  let response: Response;
  try {
    response = await fetchImpl(new URL(path, origin), {
      method: init.method,
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...(init.accessToken ? { authorization: `Bearer ${init.accessToken}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "omit",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AccountApiError("NETWORK", "Couldn't reach SessionHub. Check your connection and try again.");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorResponseSchema.safeParse(payload);
    if (parsed.success) throw new AccountApiError(parsed.data.error.code, parsed.data.error.message, parsed.data.error.retryAfterSeconds);
    throw new AccountApiError("INTERNAL_ERROR", "SessionHub answered unexpectedly. Try again later.");
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new AccountApiError("INTERNAL_ERROR", "SessionHub answered unexpectedly. Try again later.");
  return parsed.data;
};

export const requestPairing = (fetchImpl: Fetch, origin: string, body: StartPairingRequest): Promise<StartPairingResponse> =>
  call(fetchImpl, origin, "/api/v1/pairing", startPairingResponseSchema, { method: "POST", body });

export const pollPairingToken = (fetchImpl: Fetch, origin: string, deviceCode: string): Promise<PairingTokenResponse> =>
  call(fetchImpl, origin, "/api/v1/pairing/token", pairingTokenResponseSchema, { method: "POST", body: { deviceCode } });

export const refreshTokens = (fetchImpl: Fetch, origin: string, refreshToken: string): Promise<DeviceCredentials> =>
  call(fetchImpl, origin, "/api/v1/devices/token", deviceCredentialsSchema, { method: "POST", body: { refreshToken } });

export const fetchMe = (fetchImpl: Fetch, origin: string, accessToken: string): Promise<DeviceMeResponse> =>
  call(fetchImpl, origin, "/api/v1/devices/me", deviceMeResponseSchema, { method: "GET", accessToken });

export const disconnectSelf = (fetchImpl: Fetch, origin: string, accessToken: string): Promise<unknown> =>
  call(fetchImpl, origin, "/api/v1/devices/me/disconnect", deviceMeResponseSchema.shape.device, { method: "POST", accessToken });
