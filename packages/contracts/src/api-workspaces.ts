import { z } from "zod";
import { tabGroupColorSchema } from "./session";

/** /api/v1/workspaces contracts (docs/SYNC_PROTOCOL.md section 13b). Timestamps are ISO strings. */

export const WORKSPACE_LIMITS = {
  nameMax: 120,
  descriptionMax: 1000,
  iconMax: 40,
  /** Live workspaces per account; the list endpoint returns all of them in one response. */
  perUserMax: 100,
  positionMax: 10_000,
} as const;

const name = z.string().trim().min(1, "Enter a name").max(WORKSPACE_LIMITS.nameMax);
const description = z.string().trim().max(WORKSPACE_LIMITS.descriptionMax).nullable();
/** A short icon key (e.g. a Lucide name), never markup or a URL. */
const icon = z.string().regex(/^[a-z0-9-]{1,40}$/, "Use a short icon name (a-z, 0-9, -)").nullable();
const position = z.int().min(0).max(WORKSPACE_LIMITS.positionMax);

export const createWorkspaceRequestSchema = z.strictObject({
  /** Client-generated id makes a retried create idempotent (same id + content returns 200). */
  id: z.uuid().optional(),
  name,
  description: description.default(null),
  icon: icon.default(null),
  color: tabGroupColorSchema.nullable().default(null),
  position: position.default(0),
});
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const updateWorkspaceRequestSchema = z
  .strictObject({
    expectedVersion: z.int().positive(),
    name: name.optional(),
    description: description.optional(),
    icon: icon.optional(),
    color: tabGroupColorSchema.nullable().optional(),
    position: position.optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== "expectedVersion"), { message: "Change at least one field" });
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;

export const deleteWorkspaceQuerySchema = z.object({ expectedVersion: z.coerce.number().int().positive() });

export const apiWorkspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  color: tabGroupColorSchema.nullable(),
  position: z.int(),
  version: z.int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ApiWorkspace = z.infer<typeof apiWorkspaceSchema>;

export const apiWorkspaceListItemSchema = apiWorkspaceSchema.extend({
  /** Live (not deleted) sessions in this workspace, archived ones included. */
  sessionCount: z.int().nonnegative(),
});

export const listWorkspacesResponseSchema = z.object({ items: z.array(apiWorkspaceListItemSchema) });
export type ListWorkspacesResponse = z.infer<typeof listWorkspacesResponseSchema>;

export const workspaceTombstoneSchema = z.object({ id: z.uuid(), version: z.int().positive(), deletedAt: z.iso.datetime() });
export type WorkspaceTombstone = z.infer<typeof workspaceTombstoneSchema>;
