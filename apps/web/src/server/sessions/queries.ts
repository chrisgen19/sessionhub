import type { ApiSessionDetail, ListSessionsResponse } from "@sessionhub/contracts/api-sessions";
import type { PrismaClient } from "@sessionhub/database/client";
import { decodeCursor, encodeCursor } from "./cursor";
import { structureInclude, toDetail, toSummary } from "./dto";

/** Live (non-deleted) sessions, newest first, keyset-paginated. Archived ones are included and flagged. */
export const listSessionsPage = async (
  prisma: PrismaClient,
  userId: string,
  options: { limit: number; cursor?: string | undefined },
): Promise<ListSessionsResponse> => {
  const after = options.cursor ? decodeCursor(options.cursor) : null;
  const rows = await prisma.savedSession.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(after ? { OR: [{ updatedAt: { lt: after.updatedAt } }, { updatedAt: after.updatedAt, id: { lt: after.id } }] } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: options.limit + 1,
  });
  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return { items: page.map(toSummary), nextCursor: rows.length > options.limit && last ? encodeCursor(last.updatedAt, last.id) : null };
};

/** One live session owned by the user, or null (another user's or deleted look the same). */
export const getSessionDetail = async (prisma: PrismaClient, userId: string, id: string): Promise<ApiSessionDetail | null> => {
  const row = await prisma.savedSession.findFirst({ where: { id, userId, deletedAt: null }, include: structureInclude });
  return row ? toDetail(row) : null;
};
