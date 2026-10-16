/**
 * In-memory token-bucket rate limiter. Per process only: with more than one web instance
 * each keeps its own buckets (see docs/SECURITY_PRIVACY.md); move to shared storage then.
 */

export interface RateLimitPolicy {
  /** Burst size: writes allowed back to back. */
  capacity: number;
  /** Sustained rate once the burst is used. */
  refillPerSecond: number;
}

/** `/api/v1` writes per user: 30 at once, then 1 per second (60 per minute sustained). */
export const API_WRITE_LIMIT: RateLimitPolicy = { capacity: 30, refillPerSecond: 1 };

export type RateLimitDecision = { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly policy: RateLimitPolicy,
    private readonly now: () => number = Date.now,
    /** Upper bound on tracked keys so memory can't grow without limit. */
    private readonly maxKeys = 10_000,
  ) {}

  /** Takes `cost` tokens at once (a sync push pays one per operation), or none if they aren't all there. */
  take(key: string, cost = 1): RateLimitDecision {
    const now = this.now();
    const bucket = this.refilled(this.buckets.get(key), now);
    if (bucket.tokens >= cost) {
      this.store(key, { tokens: bucket.tokens - cost, updatedAt: now });
      return { allowed: true, remaining: Math.floor(bucket.tokens - cost) };
    }
    this.store(key, bucket);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((cost - bucket.tokens) / this.policy.refillPerSecond)) };
  }

  get size(): number {
    return this.buckets.size;
  }

  private refilled(bucket: Bucket | undefined, now: number): Bucket {
    if (!bucket) return { tokens: this.policy.capacity, updatedAt: now };
    const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1000;
    return { tokens: Math.min(this.policy.capacity, bucket.tokens + elapsedSeconds * this.policy.refillPerSecond), updatedAt: now };
  }

  private store(key: string, bucket: Bucket): void {
    this.buckets.delete(key); // re-insert so Map order tracks recency
    this.buckets.set(key, bucket);
    if (this.buckets.size > this.maxKeys) this.prune(bucket.updatedAt);
  }

  /** Drops buckets that have fully refilled (no state worth keeping), then the least recently used. */
  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (this.refilled(bucket, now).tokens >= this.policy.capacity) this.buckets.delete(key);
    }
    for (const key of this.buckets.keys()) {
      if (this.buckets.size <= this.maxKeys) break;
      this.buckets.delete(key);
    }
  }
}

/** Starting a pairing, per client IP: 5 at once, then 1 per minute. */
export const PAIRING_START_LIMIT: RateLimitPolicy = { capacity: 5, refillPerSecond: 1 / 60 };
/** Pairing polls and token refreshes, per client IP: 30 at once, then 1 every 2 seconds. */
export const DEVICE_TOKEN_LIMIT: RateLimitPolicy = { capacity: 30, refillPerSecond: 0.5 };

const globalForLimiter = globalThis as unknown as {
  sessionhubWriteLimiter?: TokenBucketLimiter;
  sessionhubIpLimiters?: Map<string, TokenBucketLimiter>;
};

/** Process-wide limiter for API writes (cached across Next.js dev reloads). */
export const getWriteLimiter = (): TokenBucketLimiter => {
  globalForLimiter.sessionhubWriteLimiter ??= new TokenBucketLimiter(API_WRITE_LIMIT);
  return globalForLimiter.sessionhubWriteLimiter;
};

/** Process-wide per-IP limiter for one unauthenticated endpoint family. */
export const getIpLimiter = (name: "pairing-start" | "device-token"): TokenBucketLimiter => {
  globalForLimiter.sessionhubIpLimiters ??= new Map();
  let limiter = globalForLimiter.sessionhubIpLimiters.get(name);
  if (!limiter) {
    limiter = new TokenBucketLimiter(name === "pairing-start" ? PAIRING_START_LIMIT : DEVICE_TOKEN_LIMIT);
    globalForLimiter.sessionhubIpLimiters.set(name, limiter);
  }
  return limiter;
};
