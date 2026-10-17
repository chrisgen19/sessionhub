import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export { Prisma, PrismaClient } from "./generated/client";
export type { RestoreEligibility as DbRestoreEligibility, TabGroupColor as DbTabGroupColor } from "./generated/enums";

/**
 * Resource limits for every pooled connection: no statement runs longer than 15 s, a transaction
 * left idle is ended after 30 s (releasing its locks), and waiting for a connection gives up
 * after 10 s instead of piling up requests. Mutation transactions allow 20 s in total.
 */
export const DATABASE_LIMITS = {
  statement_timeout: 15_000,
  idle_in_transaction_session_timeout: 30_000,
  connectionTimeoutMillis: 10_000,
} as const;

/**
 * Creates a Prisma client over the node-postgres driver adapter (required by Prisma 7).
 * Server-only: never import this package from the extension or client components.
 */
export const createPrismaClient = (connectionString: string | undefined = process.env.DATABASE_URL): PrismaClient => {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, ...DATABASE_LIMITS }) });
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
