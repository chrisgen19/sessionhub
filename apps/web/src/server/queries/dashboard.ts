import { WORKSPACE_LIMITS } from "@sessionhub/contracts/api-workspaces";
import type { TabGroupColor } from "@sessionhub/contracts/session";
import type { PrismaClient } from "@sessionhub/database/client";
import { NO_WORKSPACE } from "@/lib/workspace-filter";
import { toWorkspace } from "../workspaces/dto";

/**
 * Read queries for the dashboard. Every query is scoped by the caller's user id, which must
 * come from the validated server session (never from the URL or request body).
 * Soft-deleted rows (tombstones) are never shown.
 */

export interface OverviewStats {
  sessionCount: number;
  tabCount: number;
  deviceCount: number;
}

export interface SessionListItem {
  id: string;
  name: string;
  sourceDeviceName: string;
  tabCount: number;
  windowCount: number;
  updatedAt: Date;
  workspaceId: string | null;
}

export interface WorkspaceChoice {
  id: string;
  name: string;
  color: TabGroupColor | null;
}

export interface WorkspaceFilters {
  /** In display order, each with its number of sessions in the current view. */
  workspaces: (WorkspaceChoice & { sessionCount: number })[];
  /** Sessions in the current view that are in no workspace. */
  unassigned: number;
}

export interface DeviceListItem {
  id: string;
  displayName: string;
  browser: string | null;
  platform: string | null;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}

const liveSessions = (userId: string, archived = false) => ({ userId, deletedAt: null, isArchived: archived });

const sessionFields = { id: true, name: true, sourceDeviceName: true, tabCount: true, windowCount: true, updatedAt: true, workspaceId: true } as const;

/** `workspace`: an id (the caller checked it is the user's), NO_WORKSPACE, or null/absent for all. */
const inWorkspace = (workspace: string | null | undefined) =>
  workspace === NO_WORKSPACE ? { workspaceId: null } : workspace ? { workspaceId: workspace } : {};

export const getOverviewStats = async (prisma: PrismaClient, userId: string): Promise<OverviewStats> => {
  const [sessionCount, tabs, deviceCount] = await prisma.$transaction([
    prisma.savedSession.count({ where: liveSessions(userId) }),
    prisma.savedSession.aggregate({ where: liveSessions(userId), _sum: { tabCount: true } }),
    prisma.device.count({ where: { userId, revokedAt: null } }),
  ]);
  return { sessionCount, tabCount: tabs._sum.tabCount ?? 0, deviceCount };
};

export const SESSION_LIST_LIMIT = 100;

/** Newest first; optional case-insensitive name search and workspace filter. Active sessions unless `archived`. */
export const listSessions = (
  prisma: PrismaClient,
  userId: string,
  options: { query?: string; take?: number; archived?: boolean; workspace?: string | null } = {},
): Promise<SessionListItem[]> => {
  const query = options.query?.trim();
  return prisma.savedSession.findMany({
    where: {
      ...liveSessions(userId, options.archived),
      ...inWorkspace(options.workspace),
      ...(query ? { name: { contains: query, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: Math.min(options.take ?? SESSION_LIST_LIMIT, SESSION_LIST_LIMIT),
    select: sessionFields,
  });
};

/** The user's live workspaces in the server's display order (position, creation, id); at most 100. */
export const listWorkspaceChoices = async (prisma: PrismaClient, userId: string): Promise<WorkspaceChoice[]> =>
  (
    await prisma.workspace.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: WORKSPACE_LIMITS.perUserMax,
    })
  ).map((row) => {
    const { id, name, color } = toWorkspace(row);
    return { id, name, color };
  });

/** Workspaces for the sessions filter, with counts for the active (or archived) view. */
export const listWorkspaceFilters = async (prisma: PrismaClient, userId: string, { archived = false } = {}): Promise<WorkspaceFilters> => {
  const [workspaces, groups] = await Promise.all([
    listWorkspaceChoices(prisma, userId),
    prisma.savedSession.groupBy({ by: ["workspaceId"], where: liveSessions(userId, archived), _count: { _all: true } }),
  ]);
  const counts = new Map(groups.map((group) => [group.workspaceId, group._count._all]));
  return { workspaces: workspaces.map((workspace) => ({ ...workspace, sessionCount: counts.get(workspace.id) ?? 0 })), unassigned: counts.get(null) ?? 0 };
};

export const listDevices = (prisma: PrismaClient, userId: string): Promise<DeviceListItem[]> =>
  prisma.device.findMany({
    where: { userId },
    orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { lastSeenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { id: true, displayName: true, browser: true, platform: true, lastSeenAt: true, revokedAt: true },
  });
