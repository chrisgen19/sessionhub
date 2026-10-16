import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export { Prisma, PrismaClient } from "./generated/client";
export type { RestoreEligibility as DbRestoreEligibility, TabGroupColor as DbTabGroupColor } from "./generated/enums";

/**
 * Creates a Prisma client over the node-postgres driver adapter (required by Prisma 7).
 * Server-only: never import this package from the extension or client components.
 */
export const createPrismaClient = (connectionString: string | undefined = process.env.DATABASE_URL): PrismaClient => {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
};

const globalForPrisma = globalThis as unknown as { sessionhubPrisma?: PrismaClient };

/**
 * One client per process: each client owns a connection pool. Cached on globalThis so
 * Next.js dev hot reloads don't open a new pool on every edit.
 */
export const getPrisma = (): PrismaClient => {
  globalForPrisma.sessionhubPrisma ??= createPrismaClient();
  return globalForPrisma.sessionhubPrisma;
};
