import type { ApiWorkspace } from "@sessionhub/contracts/api-workspaces";
import { tabGroupColorSchema } from "@sessionhub/contracts/session";
import type { Prisma } from "@sessionhub/database/client";

type WorkspaceRow = Prisma.WorkspaceGetPayload<object>;

/** Unknown stored colors (never written by this API) read back as no color. */
const color = tabGroupColorSchema.nullable().catch(null);

export const toWorkspace = (row: WorkspaceRow): ApiWorkspace => ({
  id: row.id,
  name: row.name,
  description: row.description,
  icon: row.icon,
  color: color.parse(row.color),
  position: row.position,
  version: row.version,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Live sessions only; used for list counts and the "not empty" delete check. */
export const liveSessionCount = { _count: { select: { sessions: { where: { deletedAt: null } } } } } satisfies Prisma.WorkspaceInclude;
