import { z } from "zod";
import { SESSION_LIMITS, savedWindowSchema, tabGroupColorSchema } from "./session";

/**
 * /api/v1/sessions contracts (docs/SYNC_PROTOCOL.md section 4). Timestamps are ISO strings.
 * Write inputs order windows, groups and tabs by array position; the server assigns all
 * child ids per version (only the session id is stable) and re-classifies every URL.
 */

export const API_LIMITS = {
  /** Total tabs across all windows of one session. */
  tabsPerSessionMax: 5000,
  descriptionMax: 2000,
  pageSizeMax: 100,
  pageSizeDefault: 50,
  /** Request body cap enforced before JSON parsing. */
  requestBytesMax: 2 * 1024 * 1024,
} as const;

const tabInputSchema = z.object({
  title: z.string().max(SESSION_LIMITS.titleMax).default(""),
  url: z.string().min(1).max(SESSION_LIMITS.urlMax),
  pinned: z.boolean().default(false),
  /** Refers to a group id in the same window's `groups` (client-scoped). */
  groupId: z.uuid().nullable().default(null),
});

const groupInputSchema = z.object({
  /** Client-scoped reference for tabs; the server stores a new id. */
  id: z.uuid(),
  title: z.string().max(SESSION_LIMITS.groupTitleMax).default(""),
  color: tabGroupColorSchema.default("grey"),
  collapsed: z.boolean().default(false),
});

export const windowInputSchema = z
  .object({
    groups: z.array(groupInputSchema).max(SESSION_LIMITS.groupsPerWindowMax).default([]),
    tabs: z.array(tabInputSchema).min(1).max(SESSION_LIMITS.tabsPerWindowMax),
  })
  .superRefine((window, ctx) => {
    const groupIds = new Set<string>();
    window.groups.forEach((group, index) => {
      if (groupIds.has(group.id)) ctx.addIssue({ code: "custom", message: "Duplicate group id", path: ["groups", index, "id"] });
      groupIds.add(group.id);
    });
    window.tabs.forEach((tab, index) => {
      if (tab.groupId !== null && !groupIds.has(tab.groupId)) {
        ctx.addIssue({ code: "custom", message: "Tab references a group that is not in this window", path: ["tabs", index, "groupId"] });
      }
    });
  });
export type WindowInput = z.infer<typeof windowInputSchema>;

const windowsInputSchema = z
  .array(windowInputSchema)
  .min(1)
  .max(SESSION_LIMITS.windowsMax)
  .refine((windows) => windows.reduce((sum, window) => sum + window.tabs.length, 0) <= API_LIMITS.tabsPerSessionMax, {
    message: `A session can hold at most ${API_LIMITS.tabsPerSessionMax} tabs`,
  });

const nameSchema = z.string().trim().min(1).max(SESSION_LIMITS.nameMax);
const descriptionSchema = z.string().trim().max(API_LIMITS.descriptionMax).nullable();

export const createSessionRequestSchema = z.strictObject({
  /** Optional client-generated id; retrying the same create with the same content is idempotent. */
  id: z.uuid().optional(),
  name: nameSchema,
  description: descriptionSchema.default(null),
  workspaceId: z.uuid().nullable().default(null),
  isPinned: z.boolean().default(false),
  windows: windowsInputSchema,
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const updateSessionRequestSchema = z
  .strictObject({
    /** Must equal the current server version (optimistic concurrency). */
    expectedVersion: z.int().positive(),
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    workspaceId: z.uuid().nullable().optional(),
    isPinned: z.boolean().optional(),
    isArchived: z.boolean().optional(),
    /** Replaces the whole window/group/tab structure. */
    windows: windowsInputSchema.optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== "expectedVersion"), { message: "Nothing to update" });
export type UpdateSessionRequest = z.infer<typeof updateSessionRequestSchema>;

export const deleteSessionQuerySchema = z.object({ expectedVersion: z.coerce.number().int().positive() });

export const listSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(API_LIMITS.pageSizeMax).default(API_LIMITS.pageSizeDefault),
  cursor: z.string().max(200).optional(),
});

export const apiSessionSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  workspaceId: z.uuid().nullable(),
  sourceDeviceId: z.uuid().nullable(),
  sourceDeviceName: z.string(),
  isPinned: z.boolean(),
  isArchived: z.boolean(),
  version: z.int().positive(),
  tabCount: z.int().nonnegative(),
  windowCount: z.int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ApiSessionSummary = z.infer<typeof apiSessionSummarySchema>;

export const apiSessionDetailSchema = apiSessionSummarySchema.extend({ windows: z.array(savedWindowSchema) });
export type ApiSessionDetail = z.infer<typeof apiSessionDetailSchema>;

export const listSessionsResponseSchema = z.object({
  items: z.array(apiSessionSummarySchema),
  /** Opaque; pass back as `cursor` for the next page. Null on the last page. */
  nextCursor: z.string().nullable(),
});
export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>;

export const apiErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN_ORIGIN",
  "UNSUPPORTED_MEDIA_TYPE",
  "PAYLOAD_TOO_LARGE",
  "INVALID_JSON",
  "VALIDATION_ERROR",
  "INVALID_CURSOR",
  "NOT_FOUND",
  "INVALID_WORKSPACE",
  "VERSION_CONFLICT",
  "ID_IN_USE",
  "INTERNAL_ERROR",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    /** Field-level validation problems (VALIDATION_ERROR only). */
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    /** VERSION_CONFLICT only: the canonical server state the client should reconcile with. */
    expectedVersion: z.int().optional(),
    serverVersion: z.int().optional(),
    serverState: apiSessionDetailSchema.nullable().optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
