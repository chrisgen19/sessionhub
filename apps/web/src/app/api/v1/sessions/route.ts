import { createSessionRequestSchema, listSessionsQuerySchema } from "@sessionhub/contracts/api-sessions";
import { getPrisma } from "@sessionhub/database/client";
import { authenticate, authorizeWrite, handle, json, parseOrThrow, readJson } from "@/server/api/http";
import { createSession } from "@/server/sessions/mutations";
import { listSessionsPage } from "@/server/sessions/queries";

/** GET /api/v1/sessions?limit=&cursor=: the caller's live sessions, newest first. */
export const GET = handle(async (request: Request) => {
  const { userId } = await authenticate(request);
  const query = parseOrThrow(listSessionsQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
  return json(await listSessionsPage(getPrisma(), userId, query));
});

/** POST /api/v1/sessions: create (201), or 200 for an exact retry of the same id and content. */
export const POST = handle(async (request: Request) => {
  const { userId } = await authorizeWrite(request);
  const body = await readJson(request, createSessionRequestSchema);
  const { detail, sequence } = await createSession(getPrisma(), userId, body);
  return json(detail, sequence === null ? 200 : 201, { location: `/api/v1/sessions/${detail.id}` });
});
