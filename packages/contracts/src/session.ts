import { z } from "zod";

/** Current schema version of saved-session payloads (local records and exports). */
export const SESSION_SCHEMA_VERSION = 1;

/** Structural bounds. Values are an implementation decision recorded in docs/DATA_MODEL.md. */
export const SESSION_LIMITS = {
  nameMax: 200,
  titleMax: 1024,
  urlMax: 8192,
  groupTitleMax: 256,
  deviceNameMax: 120,
  windowsMax: 200,
  tabsPerWindowMax: 2000,
  groupsPerWindowMax: 500,
  /** Screen coordinates and sizes in pixels; generous for multi-monitor setups. */
  windowCoordinateMax: 100_000,
  /** A session's notes (the server's `description`). */
  descriptionMax: 2000,
  tagsMax: 10,
  tagMax: 32,
} as const;

/**
 * Restore eligibility decided by the URL classifier in `@sessionhub/core`.
 * Only `restorable` tabs are ever opened by a restore.
 */
export const restoreEligibilitySchema = z.enum([
  "restorable",
  "browser-internal",
  "local-file",
  "unsafe",
  "unsupported",
  "invalid",
]);
export type RestoreEligibility = z.infer<typeof restoreEligibilitySchema>;

/** Chrome tab-group colors (chrome.tabGroups.Color). */
export const tabGroupColorSchema = z.enum([
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
]);
export type TabGroupColor = z.infer<typeof tabGroupColorSchema>;

export const savedTabSchema = z.object({
  id: z.uuid(),
  title: z.string().max(SESSION_LIMITS.titleMax),
  url: z.string().max(SESSION_LIMITS.urlMax),
  pinned: z.boolean(),
  sortOrder: z.int().nonnegative(),
  groupId: z.uuid().nullable(),
  eligibility: restoreEligibilitySchema,
});
export type SavedTab = z.infer<typeof savedTabSchema>;

export const savedGroupSchema = z.object({
  id: z.uuid(),
  title: z.string().max(SESSION_LIMITS.groupTitleMax),
  color: tabGroupColorSchema,
  collapsed: z.boolean(),
  sortOrder: z.int().nonnegative(),
});
export type SavedGroup = z.infer<typeof savedGroupSchema>;

/**
 * How a window was shown when saved (docs/DATA_MODEL.md, SavedSessionWindow). A window saved
 * minimized is stored as `normal`: reopening into minimized windows would look like nothing opened.
 */
export const windowStateSchema = z.enum(["normal", "maximized", "fullscreen"]);
export type WindowState = z.infer<typeof windowStateSchema>;

const coordinate = z.int().min(-SESSION_LIMITS.windowCoordinateMax).max(SESSION_LIMITS.windowCoordinateMax);
const length = z.int().positive().max(SESSION_LIMITS.windowCoordinateMax);

/** A normal window's position and size on screen, in pixels. Only applied on the computer that saved it. */
export const windowBoundsSchema = z.strictObject({ left: coordinate, top: coordinate, width: length, height: length });
export type WindowBounds = z.infer<typeof windowBoundsSchema>;

export const savedWindowSchema = z
  .object({
    id: z.uuid(),
    sortOrder: z.int().nonnegative(),
    groups: z.array(savedGroupSchema).max(SESSION_LIMITS.groupsPerWindowMax),
    tabs: z.array(savedTabSchema).max(SESSION_LIMITS.tabsPerWindowMax),
    /** Absent in sessions saved before 2026-10-18, imported from older exports, or read without it. */
    state: windowStateSchema.optional(),
    /** Normal windows only; maximized and full-screen windows keep just their state. */
    bounds: windowBoundsSchema.optional(),
  })
  .superRefine((window, ctx) => {
    const groupIds = new Set(window.groups.map((group) => group.id));
    window.tabs.forEach((tab, index) => {
      if (tab.groupId !== null && !groupIds.has(tab.groupId)) {
        ctx.addIssue({
          code: "custom",
          message: "Tab references a group that is not in the same window",
          path: ["tabs", index, "groupId"],
        });
      }
    });
  });
export type SavedWindow = z.infer<typeof savedWindowSchema>;

/**
 * A free-form label. Stored as typed after trimming and collapsing spaces; a session never holds the
 * same tag twice, compared without case (`normalizeTags` in `@sessionhub/core/session-organize`).
 */
export const sessionTagSchema = z.string().trim().min(1).max(SESSION_LIMITS.tagMax);
export const sessionTagsSchema = z.array(sessionTagSchema).max(SESSION_LIMITS.tagsMax);

export const savedSessionSchema = z
  .object({
    id: z.uuid(),
    schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
    name: z.string().trim().min(1).max(SESSION_LIMITS.nameMax),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    /** Provenance only, never a command target. */
    sourceDeviceId: z.uuid().nullable(),
    sourceDeviceName: z.string().max(SESSION_LIMITS.deviceNameMax),
    /** Optimistic-concurrency version; starts at 1 and increments on each edit. */
    version: z.int().positive(),
    windows: z.array(savedWindowSchema).max(SESSION_LIMITS.windowsMax),
    /**
     * Organizing fields (2026-10-18), all optional: records and exports from before have none. For a
     * session of this browser absent means empty (no notes or tags, not pinned, not archived); for an
     * account's session it means not known yet, and uploads leave the server's value as it is.
     */
    description: z.string().max(SESSION_LIMITS.descriptionMax).nullable().optional(),
    tags: sessionTagsSchema.optional(),
    isPinned: z.boolean().optional(),
    isArchived: z.boolean().optional(),
  })
  .superRefine((session, ctx) => {
    const seen = new Set<string>();
    const ids = session.windows.flatMap((window) => [
      window.id,
      ...window.groups.map((group) => group.id),
      ...window.tabs.map((tab) => tab.id),
    ]);
    for (const id of ids) {
      if (seen.has(id)) {
        ctx.addIssue({ code: "custom", message: `Duplicate id ${id}`, path: ["windows"] });
        return;
      }
      seen.add(id);
    }
  });
export type SavedSession = z.infer<typeof savedSessionSchema>;
