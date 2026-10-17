import { afterEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), transaction: vi.fn() }));
vi.mock("@sessionhub/database/client", () => ({ getPrisma: () => ({ $transaction: database.transaction }) }));

const healthyDatabase = () => {
  database.query.mockResolvedValue([{ ready: 1 }]);
  database.execute.mockResolvedValue(0);
  database.transaction.mockImplementation(async (run: (tx: unknown) => Promise<void>) => run({ $queryRaw: database.query, $executeRaw: database.execute }));
};

afterEach(() => {
  vi.resetAllMocks();
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
    healthyDatabase();
    const response = await (await load(VALID))();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("is unhealthy while the configuration is invalid, without saying why", async () => {
    const response = await (await load({ ...VALID, NODE_ENV: "production", BETTER_AUTH_URL: "http://sessionhub.example" }))();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "misconfigured" });
    expect(database.transaction).not.toHaveBeenCalled();
  });
});

it("fails readiness without leaking database errors, then recovers on the next probe", async () => {
  const GET = await load(VALID);
  database.transaction.mockRejectedValueOnce(new Error("postgresql://secret@private-host:5432/db"));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ status: "unavailable" });
  healthyDatabase();
  expect((await GET()).status).toBe(200);
  expect(database.transaction).toHaveBeenLastCalledWith(expect.any(Function), { maxWait: 1000, timeout: 1500 });
  expect(database.execute).toHaveBeenCalled();
  expect(database.query).toHaveBeenCalled();
});
