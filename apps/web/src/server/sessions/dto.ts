import type { ApiSessionDetail, ApiSessionSummary } from "@sessionhub/contracts/api-sessions";
import type { RestoreEligibility, SavedWindow } from "@sessionhub/contracts/session";
import type { DbRestoreEligibility, Prisma } from "@sessionhub/database/client";
import { normalizePlacement } from "@sessionhub/core/window-placement";

/** Contracts use "-" (browser-internal); PostgreSQL enum values use "_". */
export const toDbEligibility = (value: RestoreEligibility): DbRestoreEligibility => value.replace("-", "_") as DbRestoreEligibility;
const fromDbEligibility = (value: DbRestoreEligibility): RestoreEligibility => value.replace("_", "-") as RestoreEligibility;

export const structureInclude = {
  windows: {
    orderBy: { sortOrder: "asc" },
    include: { groups: { orderBy: { sortOrder: "asc" } }, tabs: { orderBy: { sortOrder: "asc" } } },
  },
} satisfies Prisma.SavedSessionInclude;

type SessionRow = Prisma.SavedSessionGetPayload<object>;
type SessionWithStructure = Prisma.SavedSessionGetPayload<{ include: typeof structureInclude }>;

export const toSummary = (row: SessionRow): ApiSessionSummary => ({
  id: row.id,
  name: row.name,
  description: row.description,
  workspaceId: row.workspaceId,
  sourceDeviceId: row.sourceDeviceId,
  sourceDeviceName: row.sourceDeviceName,
  isPinned: row.isPinned,
  isArchived: row.isArchived,
  tags: row.tags,
  version: row.version,
  tabCount: row.tabCount,
  windowCount: row.windowCount,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** A window's stored state and bounds, through the same rules as every write (all four bounds or none). */
const placementOf = (window: SessionWithStructure["windows"][number]) => {
  const { state, boundsLeft: left, boundsTop: top, boundsWidth: width, boundsHeight: height } = window;
  const bounds = left !== null && top !== null && width !== null && height !== null ? { left, top, width, height } : null;
  return normalizePlacement({ state, bounds });
};

export const toWindows = (row: SessionWithStructure): SavedWindow[] =>
  row.windows.map((window) => ({
    id: window.id,
    sortOrder: window.sortOrder,
    ...placementOf(window),
    groups: window.groups.map((group) => ({
      id: group.id,
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
      sortOrder: group.sortOrder,
    })),
    tabs: window.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      pinned: tab.pinned,
      sortOrder: tab.sortOrder,
      groupId: tab.groupId,
      eligibility: fromDbEligibility(tab.eligibility),
    })),
  }));

export const toDetail = (row: SessionWithStructure): ApiSessionDetail => ({ ...toSummary(row), windows: toWindows(row) });
