import { describe, expect, it } from "vitest";
import { TokenBucketLimiter } from "./rate-limit";

const clock = () => {
  let now = 1_000_000;
  return { now: () => now, advance: (ms: number) => (now += ms) };
};

describe("TokenBucketLimiter", () => {
  it("allows the burst, then denies with a whole-second Retry-After", () => {
    const time = clock();
    const limiter = new TokenBucketLimiter({ capacity: 3, refillPerSecond: 1 }, time.now);
    expect([1, 2, 3].map(() => limiter.take("u").allowed)).toEqual([true, true, true]);
    expect(limiter.take("u")).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("refills over time and never above capacity", () => {
    const time = clock();
    const limiter = new TokenBucketLimiter({ capacity: 2, refillPerSecond: 0.5 }, time.now);
    limiter.take("u");
    limiter.take("u");
    expect(limiter.take("u")).toEqual({ allowed: false, retryAfterSeconds: 2 });
    time.advance(1_000);
    expect(limiter.take("u")).toEqual({ allowed: false, retryAfterSeconds: 1 });
    time.advance(1_000);
    expect(limiter.take("u")).toMatchObject({ allowed: true });
    time.advance(3_600_000);
    expect([1, 2, 3].map(() => limiter.take("u").allowed)).toEqual([true, true, false]);
  });

  it("denied attempts don't extend the wait", () => {
    const time = clock();
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 1 }, time.now);
    limiter.take("u");
    for (let i = 0; i < 50; i += 1) limiter.take("u");
    time.advance(1_000);
    expect(limiter.take("u").allowed).toBe(true);
  });

  it("keeps users independent", () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 1 }, clock().now);
    expect(limiter.take("alice").allowed).toBe(true);
    expect(limiter.take("alice").allowed).toBe(false);
    expect(limiter.take("bob").allowed).toBe(true);
  });

  it("bounds memory, dropping refilled buckets first and then the least recently used", () => {
    const time = clock();
    const limiter = new TokenBucketLimiter({ capacity: 2, refillPerSecond: 1 }, time.now, 3);
    limiter.take("idle");
    time.advance(10_000); // "idle" has fully refilled
    limiter.take("a");
    limiter.take("a");
    limiter.take("b");
    limiter.take("c");
    expect(limiter.size).toBeLessThanOrEqual(3);
    expect(limiter.take("a")).toMatchObject({ allowed: false }); // still limited: not evicted
  });
});
