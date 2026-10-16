import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("getServerEnv", () => {
  it("rejects a missing or short secret without printing its value", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://x");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("BETTER_AUTH_SECRET", "too-short-secret");
    const { getServerEnv } = await import("./env");
    expect(() => getServerEnv()).toThrow(/BETTER_AUTH_SECRET must be at least 32 characters/);
    expect(() => getServerEnv()).not.toThrow(/too-short-secret/);
  });

  it("accepts a complete configuration", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://x");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("BETTER_AUTH_SECRET", "a".repeat(32));
    const { getServerEnv } = await import("./env");
    expect(getServerEnv().BETTER_AUTH_URL).toBe("http://localhost:3000");
  });
});
