import { Prisma, type PrismaClient } from "@sessionhub/database/client";

/**
 * Token-bucket rate limits kept in PostgreSQL (`rate_limit_buckets`), so every web instance
 * shares one budget per key. Each check is one atomic statement: refill by the time elapsed on the
 * database clock (instances may disagree about the time; the database doesn't), take `cost`
 * tokens if they are all there, and record whether that was allowed.
 */

export interface RateLimitPolicy {
  /** Burst size: requests allowed back to back. */
  capacity: number;
  /** Sustained rate once the burst is used. */
  refillPerSecond: number;
}

/** `/api/v1` writes per user: 30 at once, then 1 per second (60 per minute sustained). */
export const API_WRITE_LIMIT: RateLimitPolicy = { capacity: 30, refillPerSecond: 1 };
/** `/api/v1` reads per user: 120 at once, then 2 per second (120 per minute sustained). */
export const API_READ_LIMIT: RateLimitPolicy = { capacity: 120, refillPerSecond: 2 };
/** Starting a pairing, per client IP: 5 at once, then 1 per minute. */
export const PAIRING_START_LIMIT: RateLimitPolicy = { capacity: 5, refillPerSecond: 1 / 60 };
/** Pairing polls and token refreshes, per client IP: 30 at once, then 1 every 2 seconds. */
export const DEVICE_TOKEN_LIMIT: RateLimitPolicy = { capacity: 30, refillPerSecond: 0.5 };

export type RateLimitDecision = { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

/** Every policy refills completely well within this, so deleting idler buckets changes nothing. */
const IDLE_INTERVAL = Prisma.sql`interval '1 hour'`;
const CLEANUP_CHANCE = 0.01;
const KEY_MAX = 255;

export interface TakeOptions {
  /** Tokens to take at once (a sync push pays one per operation). Never more than the capacity. */
  cost?: number;
  /** Tests only: a fixed time instead of the database clock. */
  now?: Date;
  /** Tests only: decides when to sweep idle buckets. */
  random?: () => number;
}

/** Takes `cost` tokens from the bucket at `key` all at once, or none if they aren't all there. */
export const takeTokens = async (prisma: PrismaClient, key: string, policy: RateLimitPolicy, { cost = 1, now, random = Math.random }: TakeOptions = {}): Promise<RateLimitDecision> => {
  const at = now ? Prisma.sql`${now}::timestamptz` : Prisma.sql`now()`;
  const capacity = Prisma.sql`${policy.capacity}::float8`;
  const need = Prisma.sql`${cost}::float8`;
  const refilled = Prisma.sql`LEAST(${capacity}, b."tokens" + GREATEST(0, EXTRACT(EPOCH FROM (${at} - b."updated_at"))) * ${policy.refillPerSecond}::float8)`;
  const rows = await prisma.$queryRaw<{ tokens: number; allowed: boolean }[]>`
    INSERT INTO "rate_limit_buckets" AS b ("key", "tokens", "allowed", "updated_at")
    VALUES (${key.slice(0, KEY_MAX)}, CASE WHEN ${capacity} >= ${need} THEN ${capacity} - ${need} ELSE ${capacity} END, ${capacity} >= ${need}, ${at})
    ON CONFLICT ("key") DO UPDATE SET
      "tokens" = CASE WHEN ${refilled} >= ${need} THEN ${refilled} - ${need} ELSE ${refilled} END,
      "allowed" = ${refilled} >= ${need},
      "updated_at" = ${at}
    RETURNING "tokens", "allowed"`;
  if (random() < CLEANUP_CHANCE) await prisma.$executeRaw`DELETE FROM "rate_limit_buckets" WHERE "updated_at" < ${at} - ${IDLE_INTERVAL}`;
  const row = rows[0];
  if (!row) throw new Error("Rate limit update returned no row");
  const tokens = Number(row.tokens);
  if (row.allowed) return { allowed: true, remaining: Math.floor(tokens) };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((cost - tokens) / policy.refillPerSecond)) };
};

/**
 * Better Auth's rate-limit storage (`rateLimit.customStorage`): its sign-in and reset limits then
 * hold across instances too. Its "max per window" rule becomes a bucket that holds `max` and
 * refills `max` per window: the same burst, refilled gradually instead of all at once.
 */
export const authRateLimitStorage = (prisma: () => PrismaClient) => ({
  consume: async (key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean; retryAfter: number | null }> => {
    const decision = await takeTokens(prisma(), `auth:${key}`, { capacity: rule.max, refillPerSecond: rule.max / rule.window });
    return decision.allowed ? { allowed: true, retryAfter: null } : { allowed: false, retryAfter: decision.retryAfterSeconds };
  },
});
