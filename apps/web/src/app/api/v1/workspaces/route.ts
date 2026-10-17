import { createWorkspaceRequestSchema } from "@sessionhub/contracts/api-workspaces";
import { getPrisma } from "@sessionhub/database/client";
import { authorizeRead, authorizeWrite, handle, json, readJson } from "@/server/api/http";
import { createWorkspace, listWorkspaces } from "@/server/workspaces/service";

/** GET /api/v1/workspaces: every live workspace (at most 100) in display order, with session counts. */
export const GET = handle(async (request: Request) => {
  const { userId } = await authorizeRead(request);
  return json(await listWorkspaces(getPrisma(), userId));
});

/** POST /api/v1/workspaces: create (201), or 200 for an exact retry of the same id and content. */
export const POST = handle(async (request: Request) => {
  const { userId } = await authorizeWrite(request);
  const body = await readJson(request, createWorkspaceRequestSchema);
  const { workspace, sequence } = await createWorkspace(getPrisma(), userId, body);
  return json(workspace, sequence === null ? 200 : 201, { location: `/api/v1/workspaces/${workspace.id}` });
});
