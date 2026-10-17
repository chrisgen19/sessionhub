import { deleteSessionQuerySchema, updateSessionRequestSchema } from "@sessionhub/contracts/api-sessions";
import { getPrisma } from "@sessionhub/database/client";
import { authenticate, authorizeWrite, handle, HttpError, json, parseOrThrow, readJson, sessionIdOrNotFound } from "@/server/api/http";
import { deleteSession, updateSession } from "@/server/sessions/mutations";
import { getSessionDetail } from "@/server/sessions/queries";

type Context = RouteContext<"/api/v1/sessions/[id]">;

/** GET: one live session with its windows, groups and tabs. Another user's id is a 404. */
export const GET = handle(async (request: Request, context: Context) => {
  const { userId } = await authenticate(request);
  const id = sessionIdOrNotFound((await context.params).id);
  const detail = await getSessionDetail(getPrisma(), userId, id);
  if (!detail) throw new HttpError(404, "NOT_FOUND", "Session not found.");
  return json(detail);
});

/** PATCH: partial update guarded by `expectedVersion`; 409 with the server state when stale. */
export const PATCH = handle(async (request: Request, context: Context) => {
  const { userId } = await authorizeWrite(request);
  const id = sessionIdOrNotFound((await context.params).id);
  const body = await readJson(request, updateSessionRequestSchema);
  return json((await updateSession(getPrisma(), userId, id, body)).detail);
});

/** DELETE ?expectedVersion=N: tombstone. Repeating it returns the same tombstone. */
export const DELETE = handle(async (request: Request, context: Context) => {
  const { userId } = await authorizeWrite(request);
  const id = sessionIdOrNotFound((await context.params).id);
  const { expectedVersion } = parseOrThrow(deleteSessionQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
  const { sequence: _sequence, ...result } = await deleteSession(getPrisma(), userId, id, expectedVersion);
  return json(result);
});
