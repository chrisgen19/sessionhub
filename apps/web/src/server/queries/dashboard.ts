import type { PrismaClient } from "@sessionhub/database/client";

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
}

export interface DeviceListItem {
  id: string;
  displayName: string;
  browser: string | null;
  platform: string | null;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}

const liveSessions = (userId: string) => ({ userId, deletedAt: null, isArchived: false });

const sessionFields = { id: true, name: true, sourceDeviceName: true, tabCount: true, windowCount: true, updatedAt: true } as const;

export const getOverviewStats = async (prisma: PrismaClient, userId: string): Promise<OverviewStats> => {
  const [sessionCount, tabs, deviceCount] = await prisma.$transaction([
    prisma.savedSession.count({ where: liveSessions(userId) }),
    prisma.savedSession.aggregate({ where: liveSessions(userId), _sum: { tabCount: true } }),
    prisma.device.count({ where: { userId, revokedAt: null } }),
  ]);
  return { sessionCount, tabCount: tabs._sum.tabCount ?? 0, deviceCount };
};

export const SESSION_LIST_LIMIT = 100;

/** Newest first; optional case-insensitive name search. */
export const listSessions = (
  prisma: PrismaClient,
  userId: string,
  options: { query?: string; take?: number } = {},
): Promise<SessionListItem[]> => {
  const query = options.query?.trim();
  return prisma.savedSession.findMany({
    where: { ...liveSessions(userId), ...(query ? { name: { contains: query, mode: "insensitive" as const } } : {}) },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: Math.min(options.take ?? SESSION_LIST_LIMIT, SESSION_LIST_LIMIT),
    select: sessionFields,
  });
};

export const listDevices = (prisma: PrismaClient, userId: string): Promise<DeviceListItem[]> =>
  prisma.device.findMany({
    where: { userId },
    orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { lastSeenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { id: true, displayName: true, browser: true, platform: true, lastSeenAt: true, revokedAt: true },
  });
