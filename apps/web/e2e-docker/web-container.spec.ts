import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASE_URL, compose, COMPOSE_FILE, PROJECT } from "./stack";

const psql = (sql: string) => compose(["exec", "-T", "postgres", "psql", "-U", "sessionhub", "-d", "sessionhub", "-tAc", sql]).trim();
const inWeb = (...command: string[]) => compose(["exec", "-T", "web", ...command]).trim();

test("the stack is healthy and migrations ran as their own completed step", async () => {
  const states = JSON.parse(`[${compose(["ps", "-a", "--format", "json"]).trim().split("\n").join(",")}]`) as {
    Service: string;
    State: string;
    Health: string;
    ExitCode: number;
  }[];
  const byService = Object.fromEntries(states.map((state) => [state.Service, state]));
  expect(byService.postgres).toMatchObject({ State: "running", Health: "healthy" });
  expect(byService.web).toMatchObject({ State: "running", Health: "healthy" });
  expect(byService.migrate).toMatchObject({ State: "exited", ExitCode: 0 });
  expect(psql("select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")).toBe("1");
  expect(compose(["logs", "migrate"])).toMatch(/applied|All migrations have been successfully applied/i);
});

test("health endpoint and a full sign-up -> API -> dashboard round trip work in the container", async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL } });
  const health = await api.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  expect(health.headers()["cache-control"]).toBe("no-store");

  const email = `docker-${randomUUID()}@example.test`;
  expect((await api.post("/api/auth/sign-up/email", { data: { name: "Container", email, password: "correct horse battery" } })).ok()).toBe(true);
  const created = await api.post("/api/v1/sessions", { data: { name: "From the container", windows: [{ tabs: [{ url: "https://a.test/" }] }] } });
  expect(created.status()).toBe(201);
  const session = await created.json();
  expect(await (await api.get(`/api/v1/sessions/${session.id}`)).json()).toMatchObject({ name: "From the container", version: 1 });

  const page = await api.get("/app/sessions");
  expect(page.status()).toBe(200);
  expect(await page.text()).toContain("From the container");
  expect(psql(`select count(*) from sync_changes where entity_id = '${session.id}'`)).toBe("1");
});

test("re-running the migration job is a safe no-op", () => {
  const output = compose(["run", "--rm", "--no-deps", "migrate"]);
  expect(output).toMatch(/No pending migrations to apply/i);
  expect(psql("select count(*) from _prisma_migrations")).toBe("1");
});

test("the web container is locked down", () => {
  expect(inWeb("id", "-u")).toBe("1000");
  expect(inWeb("sh", "-c", "find /app -name '.env*' | wc -l")).toBe("0");
  expect(() => inWeb("touch", "/app/apps/web/server.js")).toThrow();
  expect(inWeb("sh", "-c", "touch /app/apps/web/.next/cache/ok && echo writable")).toBe("writable");
  // PostgreSQL is only on the compose network, never published to the host.
  const [postgresLine = "{}"] = compose(["ps", "postgres", "--format", "json"]).trim().split("\n");
  const postgres = JSON.parse(postgresLine) as { Publishers?: { PublishedPort: number }[] | null };
  expect((postgres.Publishers ?? []).filter((publisher) => publisher.PublishedPort > 0)).toEqual([]);
});

test("compose refuses to start without the required secrets", () => {
  const run = (env: Record<string, string>) => {
    try {
      execFileSync("docker", ["compose", "-p", `${PROJECT}-config`, "-f", COMPOSE_FILE, "config", "--quiet"], {
        env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      return "ok";
    } catch (error) {
      return String((error as { stderr?: Buffer }).stderr ?? error);
    }
  };
  const secret = randomBytes(32).toString("hex");
  expect(run({ BETTER_AUTH_SECRET: secret })).toMatch(/POSTGRES_PASSWORD/);
  expect(run({ POSTGRES_PASSWORD: "x" })).toMatch(/BETTER_AUTH_SECRET/);
  expect(run({ POSTGRES_PASSWORD: "x", BETTER_AUTH_SECRET: secret })).toBe("ok");
});
