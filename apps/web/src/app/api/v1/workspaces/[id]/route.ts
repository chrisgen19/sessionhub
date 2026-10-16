import { deleteWorkspaceQuerySchema, updateWorkspaceRequestSchema } from "@sessionhub/contracts/api-workspaces";
import { getPrisma } from "@sessionhub/database/client";
import { authorizeWrite, handle, idOrNotFound, json, parseOrThrow, readJson } from "@/server/api/http";
import { deleteWorkspace, updateWorkspace } from "@/server/workspaces/service";

type Context = RouteContext<"/api/v1/workspaces/[id]">;

/** PATCH: partial update guarded by `expectedVersion`; 409 with the server state when stale. */
export const PATCH = handle(async (request: Request, context: Context) => {
  const { userId } = await authorizeWrite(request);
  const id = idOrNotFound((await context.params).id, "Workspace");
  const body = await readJson(request, updateWorkspaceRequestSchema);
  return json((await updateWorkspace(getPrisma(), userId, id, body)).workspace);
});

/** DELETE ?expectedVersion=N: tombstone; 409 WORKSPACE_NOT_EMPTY while it still has sessions. */
export const DELETE = handle(async (request: Request, context: Context) => {
  const { userId } = await authorizeWrite(request);
  const id = idOrNotFound((await context.params).id, "Workspace");
  const { expectedVersion } = parseOrThrow(deleteWorkspaceQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
  const { sequence: _sequence, ...tombstone } = await deleteWorkspace(getPrisma(), userId, id, expectedVersion);
  return json(tombstone);
});
