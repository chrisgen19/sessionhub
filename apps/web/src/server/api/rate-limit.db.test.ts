import { randomUUID } from "node:crypto";
import { createPrismaClient, getPrisma } from "@sessionhub/database/client";
import { afterAll, describe, expect, it } from "vitest";
import { captureLogs } from "../observability/logger";
import { authRateLimitStorage, takeTokens, type RateLimitPolicy } from "./rate-limit";

const prisma = getPrisma();
// A second client is a second connection pool: what another web instance would use.
const otherInstance = createPrismaClient(process.env.DATABASE_URL);
afterAll(async () => {
  await prisma.$disconnect();
  await otherInstance.$disconnect();
});

const T = new Date("2026-10-16T12:00:00.000Z");
const at = (seconds: number) => new Date(T.getTime() + seconds * 1000);
const key = () => `test:${randomUUID()}`;
const noSweep = () => 1;
const take = (k: string, policy: RateLimitPolicy, seconds = 0, cost = 1) => takeTokens(prisma, k, policy, { cost, now: at(seconds), random: noSweep });

describe("shared token buckets", () => {
  it("allows the burst, then denies with a whole-second Retry-After", async () => {
    const k = key();
    const policy = { capacity: 3, refillPerSecond: 1 };
    const results = [await take(k, policy), await take(k, policy), await take(k, policy), await take(k, policy)];
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
    expect(results[3]).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("refills over time, never above capacity, and denied attempts don't extend the wait", async () => {
    const k = key();
    const policy = { capacity: 2, refillPerSecond: 0.5 };
    await take(k, policy);
    await take(k, policy);
    expect(await take(k, policy, 0)).toEqual({ allowed: false, retryAfterSeconds: 2 });
    for (let attempt = 0; attempt < 20; attempt += 1) await take(k, policy, 1);
    expect(await take(k, policy, 1)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(await take(k, policy, 2)).toMatchObject({ allowed: true });
    const later = [await take(k, policy, 3600), await take(k, policy, 3600), await take(k, policy, 3600)];
    expect(later.map((result) => result.allowed)).toEqual([true, true, false]);
  });

  it("takes a multi-token cost all at once or not at all", async () => {
    const k = key();
    const policy = { capacity: 30, refillPerSecond: 1 };
    expect(await take(k, policy, 0, 25)).toEqual({ allowed: true, remaining: 5 });
    expect(await take(k, policy, 0, 10)).toEqual({ allowed: false, retryAfterSeconds: 5 });
    expect(await take(k, policy, 0, 5)).toEqual({ allowed: true, remaining: 0 });
  });

  it("keeps keys independent", async () => {
    const [alice, bob] = [key(), key()];
    const policy = { capacity: 1, refillPerSecond: 0.001 };
    expect((await take(alice, policy)).allowed).toBe(true);
    expect((await take(alice, policy)).allowed).toBe(false);
    expect((await take(bob, policy)).allowed).toBe(true);
  });

  it("is one budget across instances: 60 concurrent requests from two clients let exactly 30 through", async () => {
    const k = key();
    const policy = { capacity: 30, refillPerSecond: 0.001 };
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, index) => takeTokens(index % 2 === 0 ? prisma : otherInstance, k, policy, { now: T, random: noSweep })),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(30);
  });

  it("now and then deletes buckets idle long enough to be full again, and only those", async () => {
    const [idle, busy] = [key(), key()];
    const policy = { capacity: 5, refillPerSecond: 1 };
    await take(idle, policy, -7200);
    await take(busy, policy, -60);
    await takeTokens(prisma, key(), policy, { now: T, random: () => 0 });
    const left = await prisma.rateLimitBucket.findMany({ where: { key: { in: [idle, busy] } }, select: { key: true } });
    expect(left.map((row) => row.key)).toEqual([busy]);
  });

  it("a failed sweep (timeout, deadlock) never fails the request whose token it already took", async () => {
    const k = key();
    const policy = { capacity: 2, refillPerSecond: 0.001 };
    const timeout = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    // The real database for the bucket update; only the sweep fails.
    const sweepFails = new Proxy(prisma, {
      get: (target, property) => {
        if (property === "$executeRaw") return () => Promise.reject(timeout);
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const lines: string[] = [];
    const restore = captureLogs((level, line) => lines.push(`${level} ${line}`));
    try {
      expect(await takeTokens(sweepFails, k, policy, { now: T, random: () => 0 })).toEqual({ allowed: true, remaining: 1 });
    } finally {
      restore();
    }
    expect(await take(k, policy)).toEqual({ allowed: true, remaining: 0 });
    expect(lines).toEqual([expect.stringMatching(/^warn .*"event":"rate_limit_sweep_failed"/)]);
  });
});

describe("Better Auth storage", () => {
  it("allows max requests per window on the shared buckets, then reports when to retry", async () => {
    const storage = authRateLimitStorage(() => prisma);
    const k = `${randomUUID()}/sign-in/email`;
    const results = [];
    for (let attempt = 0; attempt < 4; attempt += 1) results.push(await storage.consume(k, { window: 10, max: 3 }));
    expect(results.slice(0, 3)).toEqual([
      { allowed: true, retryAfter: null },
      { allowed: true, retryAfter: null },
      { allowed: true, retryAfter: null },
    ]);
    expect(results[3]).toMatchObject({ allowed: false });
    expect(results[3]!.retryAfter).toBeGreaterThanOrEqual(1);
    expect(await prisma.rateLimitBucket.count({ where: { key: `auth:${k}` } })).toBe(1);
  });
});
