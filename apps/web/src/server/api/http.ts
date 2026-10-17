import { API_LIMITS, type ApiErrorCode, type ApiErrorResponse } from "@sessionhub/contracts/api-sessions";
import { z } from "zod";
import { getAuth } from "@/server/auth";
import { getServerEnv } from "@/server/env";
import { ServiceError } from "@/server/service-errors";
import { getWriteLimiter } from "./rate-limit";

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
  WORKSPACE_NOT_EMPTY: 409,
  LIMIT_REACHED: 422,
};

const toResponse = (error: unknown): Response => {
  if (error instanceof HttpError) {
    const retryAfter = error.extra.retryAfterSeconds;
    return json({ error: { code: error.code, message: error.message, ...error.extra } }, error.status, retryAfter ? { "retry-after": String(retryAfter) } : {});
  }
  if (error instanceof ServiceError) {
    return json({ error: { code: error.code, message: error.message, ...error.details } }, SERVICE_STATUS[error.code] ?? 400);
  }
  // Class name only: never log request bodies, URLs or user data.
  console.error(`[api] unexpected ${error instanceof Error ? error.name : typeof error}`);
  return json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Try again." } }, 500);
};

/** Wraps a route handler so every failure becomes a typed JSON error. */
export const handle =
  <C>(fn: (request: Request, context: C) => Promise<Response>) =>
  async (request: Request, context: C): Promise<Response> => {
    try {
      return await fn(request, context);
    } catch (error) {
      return toResponse(error);
    }
  };

/** The signed-in user (Better Auth session cookie). Device tokens for the extension arrive in M4. */
export const authenticate = async (request: Request): Promise<{ userId: string }> => {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to use the SessionHub API.");
  return { userId: session.user.id };
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
export const authorizeWrite = async (request: Request): Promise<{ userId: string }> => {
  assertSameOrigin(request);
  const { userId } = await authenticate(request);
  const decision = getWriteLimiter().take(userId);
  if (!decision.allowed) {
    throw new HttpError(429, "RATE_LIMITED", `Too many changes in a short time. Try again in ${decision.retryAfterSeconds} seconds.`, {
      retryAfterSeconds: decision.retryAfterSeconds,
    });
  }
  return { userId };
};

/** Reads a bounded JSON body and validates it. Size is checked before parsing. */
export const readJson = async <T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> => {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the body as application/json.");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > API_LIMITS.requestBytesMax) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  const text = await request.text();
  if (Buffer.byteLength(text) > API_LIMITS.requestBytesMax) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
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
