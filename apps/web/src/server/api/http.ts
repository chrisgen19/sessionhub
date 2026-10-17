import { API_LIMITS, type ApiErrorCode, type ApiErrorResponse } from "@sessionhub/contracts/api-sessions";
import { z } from "zod";
import { getPrisma } from "@sessionhub/database/client";
import { getAuth } from "@/server/auth";
import { authenticateAccessToken, type DevicePrincipal } from "@/server/devices/credentials";
import { bearerToken } from "@/server/devices/tokens";
import { getServerEnv } from "@/server/env";
import { log } from "@/server/observability/logger";
import { observeRequest, readBodyText } from "@/server/observability/request";
import { ServiceError } from "@/server/service-errors";
import { API_READ_LIMIT, API_WRITE_LIMIT, DEVICE_TOKEN_LIMIT, PAIRING_START_LIMIT, takeTokens, type RateLimitPolicy } from "./rate-limit";

/** Error the HTTP layer turns into an `{ error }` JSON response. */
export class HttpError extends Error {
  override name = "HttpError";
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly extra: Omit<ApiErrorResponse["error"], "code" | "message"> = {},
  ) {
    super(message);
  }
}

const NO_STORE = { "cache-control": "no-store" };

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  Response.json(data, { status, headers: { ...NO_STORE, ...headers } });

const SERVICE_STATUS: Partial<Record<ApiErrorCode, number>> = {
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  ID_IN_USE: 409,
  INVALID_WORKSPACE: 422,
  INVALID_CURSOR: 400,
  CURSOR_EXPIRED: 410,
  WORKSPACE_NOT_EMPTY: 409,
  LIMIT_REACHED: 422,
  PAIRING_EXPIRED: 410,
  PAIRING_DENIED: 403,
  EMAIL_NOT_CONFIRMED: 403,
  INVALID_TOKEN: 401,
  ACCESS_TOKEN_EXPIRED: 401,
  DEVICE_REVOKED: 401,
  RATE_LIMITED: 429,
};

/** RFC 6750: tell bearer clients why their token was refused. */
const BEARER_ERRORS: Partial<Record<ApiErrorCode, string>> = {
  INVALID_TOKEN: 'Bearer error="invalid_token"',
  ACCESS_TOKEN_EXPIRED: 'Bearer error="invalid_token", error_description="expired"',
  DEVICE_REVOKED: 'Bearer error="invalid_token", error_description="revoked"',
};

const toResponse = (error: unknown): Response => {
  if (error instanceof HttpError) {
    const retryAfter = error.extra.retryAfterSeconds;
    return json({ error: { code: error.code, message: error.message, ...error.extra } }, error.status, retryAfter ? { "retry-after": String(retryAfter) } : {});
  }
  if (error instanceof ServiceError) {
    const headers: Record<string, string> = {};
    if (error.details.retryAfterSeconds) headers["retry-after"] = String(error.details.retryAfterSeconds);
    const bearer = BEARER_ERRORS[error.code];
    if (bearer) headers["www-authenticate"] = bearer;
    return json({ error: { code: error.code, message: error.message, ...error.details } }, SERVICE_STATUS[error.code] ?? 400, headers);
  }
  // Class (and Prisma code) only: never request bodies, URLs or user data.
  const code = (error as { code?: unknown } | null)?.code;
  log("error", "api_unexpected_error", { errorClass: error instanceof Error ? error.name : typeof error, prismaCode: typeof code === "string" && /^P\d{4}$/.test(code) ? code : undefined });
  return json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Try again." } }, 500);
};

/** Wraps a route handler: every failure becomes a typed JSON error, and the request gets an id and an access log line. */
export const handle =
  <C>(fn: (request: Request, context: C) => Promise<Response>) =>
  (request: Request, context: C): Promise<Response> =>
    observeRequest(request, async () => {
      try {
        return await fn(request, context);
      } catch (error) {
        return toResponse(error);
      }
    });

/** The signed-in user (Better Auth session cookie). Device tokens for the extension arrive in M4. */
export const authenticate = async (request: Request): Promise<{ userId: string; emailVerified: boolean }> => {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to use the SessionHub API.");
  return { userId: session.user.id, emailVerified: session.user.emailVerified };
};

/**
 * Device (extension) requests: `Authorization: Bearer shd_at_...` only, never cookies. Checked
 * against the database on every request, so a revoke takes effect immediately.
 */
export const authenticateDevice = async (request: Request): Promise<DevicePrincipal> => {
  const token = bearerToken(request);
  if (!token) {
    throw new HttpError(401, "UNAUTHENTICATED", "Send this device's access token as a Bearer token.");
  }
  return authenticateAccessToken(getPrisma(), token);
};

/** First client address from X-Forwarded-For (the proxy must overwrite it; see SECURITY_PRIVACY.md). */
export const clientIp = (request: Request): string => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

/** Takes from a shared bucket (all web instances, see rate-limit.ts) or throws 429 with Retry-After. */
const charge = async (key: string, policy: RateLimitPolicy, cost: number, message: string): Promise<void> => {
  const decision = await takeTokens(getPrisma(), key, policy, { cost });
  if (!decision.allowed) {
    throw new HttpError(429, "RATE_LIMITED", `${message} Try again in ${decision.retryAfterSeconds} seconds.`, { retryAfterSeconds: decision.retryAfterSeconds });
  }
};

const IP_POLICIES = { "pairing-start": PAIRING_START_LIMIT, "device-token": DEVICE_TOKEN_LIMIT } as const;

/** Per-IP limit for unauthenticated device endpoints (pairing start, token poll, refresh). */
export const limitByIp = (request: Request, name: keyof typeof IP_POLICIES): Promise<void> =>
  charge(`ip:${name}:${clientIp(request)}`, IP_POLICIES[name], 1, "Too many requests in a short time.");

/** Takes `count` writes from the account's shared budget (web and devices alike), or throws 429 without taking any. */
export const chargeWrites = (userId: string, count: number): Promise<void> => charge(`write:${userId}`, API_WRITE_LIMIT, count, "Too many changes in a short time.");

/** Takes one read from the account's read budget (web and devices alike). */
export const chargeRead = (userId: string): Promise<void> => charge(`read:${userId}`, API_READ_LIMIT, 1, "Too many requests in a short time.");

/** Device writes share the account's write budget with the web app. */
export const authorizeDeviceWrite = async (request: Request): Promise<DevicePrincipal> => {
  const principal = await authenticateDevice(request);
  await chargeWrites(principal.userId, 1);
  return principal;
};

/** Device reads: Bearer authentication, then the account's read budget. */
export const authorizeDeviceRead = async (request: Request): Promise<DevicePrincipal> => {
  const principal = await authenticateDevice(request);
  await chargeRead(principal.userId);
  return principal;
};

/**
 * CSRF defense for cookie-authenticated writes: the Origin header must be this app's origin.
 * Browsers always send it on cross-origin and same-origin fetch writes.
 */
export const assertSameOrigin = (request: Request): void => {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(getServerEnv().BETTER_AUTH_URL).origin) {
    throw new HttpError(403, "FORBIDDEN_ORIGIN", "This request must come from the SessionHub web app.");
  }
};

/**
 * Gate for every /api/v1 write, in this order: same-origin check, authentication, then the
 * per-user write limit (so anonymous or cross-site requests never consume a user's budget).
 */
export const authorizeWrite = async (request: Request): Promise<{ userId: string; emailVerified: boolean }> => {
  assertSameOrigin(request);
  const user = await authenticate(request);
  await chargeWrites(user.userId, 1);
  return user;
};

/** Gate for every cookie-authenticated /api/v1 read: authentication, then the per-user read limit. */
export const authorizeRead = async (request: Request): Promise<{ userId: string; emailVerified: boolean }> => {
  const user = await authenticate(request);
  await chargeRead(user.userId);
  return user;
};

/** Reads a bounded JSON body and validates it. Size is checked before parsing. */
export const readJson = async <T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> => {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the body as application/json.");
  }
  // Bounded read: stops at the limit even without (or with a false) Content-Length.
  const text = await readBodyText(request, API_LIMITS.requestBytesMax);
  if (text === null) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "The request body isn't valid JSON.");
  }
  return parseOrThrow(schema, data);
};

export const parseOrThrow = <T extends z.ZodType>(schema: T, data: unknown): z.infer<T> => {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issues = result.error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join("."), message: issue.message }));
  throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid.", { issues });
};

/** Route ids that aren't UUIDs can't exist: answer 404 like any other missing record. */
export const idOrNotFound = (id: string, label = "Session"): string => {
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "NOT_FOUND", `${label} not found.`);
  return id;
};

export const sessionIdOrNotFound = (id: string): string => idOrNotFound(id);
