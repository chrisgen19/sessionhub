import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const load = async (env: Record<string, string>) => {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return (await import("./route")).GET;
};

const VALID = { DATABASE_URL: "postgresql://x", BETTER_AUTH_SECRET: "a".repeat(32), BETTER_AUTH_URL: "https://sessionhub.example", MAIL_TRANSPORT: "" };

describe("GET /api/health", () => {
  it("returns an uncached ok status without internals", async () => {
    const response = (await load(VALID))();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("is unhealthy while the configuration is invalid, without saying why", async () => {
    const response = (await load({ ...VALID, NODE_ENV: "production", BETTER_AUTH_URL: "http://sessionhub.example" }))();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "misconfigured" });
  });
});
