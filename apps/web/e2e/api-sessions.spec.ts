import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type APIRequest, type APIRequestContext } from "@playwright/test";
import { BASE_URL } from "../playwright.config";

const randomIp = () => {
  const [a, b, c] = randomBytes(3);
  return `10.${a}.${b}.${c}`;
};

/** A signed-up API client with its own cookie jar and rate-limit bucket. */
const newApiUser = async (playwright: APIRequest) => {
  const api = await playwright.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL, "x-forwarded-for": randomIp() } });
  const signUp = await api.post("/api/auth/sign-up/email", {
    data: { name: "API Tester", email: `api-${randomUUID()}@example.test`, password: "correct horse battery" },
  });
  expect(signUp.ok()).toBe(true);
  return api;
};

const group = randomUUID();
const sessionBody = (overrides: Record<string, unknown> = {}) => ({
  name: "API research",
  windows: [{ groups: [{ id: group, title: "Docs", color: "blue" }], tabs: [{ url: "https://a.test/", title: "A", groupId: group }, { url: "https://b.test/" }] }],
  ...overrides,
});

const create = async (api: APIRequestContext, overrides: Record<string, unknown> = {}) => {
  const response = await api.post("/api/v1/sessions", { data: sessionBody(overrides) });
  expect(response.status()).toBe(201);
  return response.json();
};

test("requires a signed-in session", async ({ playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL } });
  const list = await anonymous.get("/api/v1/sessions");
  expect(list.status()).toBe(401);
  expect(await list.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  expect((await anonymous.post("/api/v1/sessions", { data: sessionBody() })).status()).toBe(401);
  expect(list.headers()["cache-control"]).toBe("no-store");
});

test("create, read, update with versions, conflict, tombstone and idempotent delete", async ({ playwright }) => {
  const api = await newApiUser(playwright.request);
  const response = await api.post("/api/v1/sessions", { data: sessionBody() });
  expect(response.status()).toBe(201);
  const created = await response.json();
  expect(response.headers().location).toBe(`/api/v1/sessions/${created.id}`);
  expect(created).toMatchObject({ name: "API research", version: 1, tabCount: 2, windowCount: 1, sourceDeviceName: "Web" });

  const list = await (await api.get("/api/v1/sessions?limit=10")).json();
  expect(list).toMatchObject({ items: [{ id: created.id, version: 1 }], nextCursor: null });
  expect(await (await api.get(`/api/v1/sessions/${created.id}`)).json()).toEqual(created);

  const patched = await api.patch(`/api/v1/sessions/${created.id}`, { data: { expectedVersion: 1, name: "Renamed" } });
  expect(patched.status()).toBe(200);
  expect(await patched.json()).toMatchObject({ name: "Renamed", version: 2 });

  const stale = await api.patch(`/api/v1/sessions/${created.id}`, { data: { expectedVersion: 1, name: "Stale" } });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({
    error: { code: "VERSION_CONFLICT", expectedVersion: 1, serverVersion: 2, serverState: { name: "Renamed", version: 2 } },
  });
  expect((await api.delete(`/api/v1/sessions/${created.id}?expectedVersion=1`)).status()).toBe(409);

  const deleted = await api.delete(`/api/v1/sessions/${created.id}?expectedVersion=2`);
  expect(deleted.status()).toBe(200);
  const tombstone = await deleted.json();
  expect(tombstone).toMatchObject({ id: created.id, version: 3 });
  expect((await api.get(`/api/v1/sessions/${created.id}`)).status()).toBe(404);
  expect(await (await api.delete(`/api/v1/sessions/${created.id}?expectedVersion=2`)).json()).toEqual(tombstone);
  expect((await api.patch(`/api/v1/sessions/${created.id}`, { data: { expectedVersion: 3, name: "Back" } })).status()).toBe(404);
});

test("another user can't read, change or delete a session", async ({ playwright }) => {
  const alice = await newApiUser(playwright.request);
  const bob = await newApiUser(playwright.request);
  const session = await create(alice);

  for (const response of [
    await bob.get(`/api/v1/sessions/${session.id}`),
    await bob.patch(`/api/v1/sessions/${session.id}`, { data: { expectedVersion: 1, name: "Pwned" } }),
    await bob.delete(`/api/v1/sessions/${session.id}?expectedVersion=1`),
  ]) {
    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  }
  expect((await bob.post("/api/v1/sessions", { data: sessionBody({ id: session.id }) })).status()).toBe(409);
  expect((await (await bob.get("/api/v1/sessions")).json()).items).toEqual([]);
  expect(await (await alice.get(`/api/v1/sessions/${session.id}`)).json()).toEqual(session);
});

test("rejects cross-origin, malformed, oversized and unknown-field writes", async ({ playwright }) => {
  const api = await newApiUser(playwright.request);
  const post = (headers: Record<string, string>, data: unknown) => api.post("/api/v1/sessions", { headers, data });

  expect(await (await post({ origin: "https://evil.test" }, sessionBody())).json()).toMatchObject({ error: { code: "FORBIDDEN_ORIGIN" } });
  expect((await post({ origin: "" }, sessionBody())).status()).toBe(403);
  expect((await post({ "content-type": "text/plain" }, JSON.stringify(sessionBody()))).status()).toBe(415);
  // A Buffer is sent as raw bytes (a string would be JSON-encoded by Playwright).
  const badJson = await post({ "content-type": "application/json" }, Buffer.from("{not json"));
  expect(await badJson.json()).toMatchObject({ error: { code: "INVALID_JSON" } });

  const unknownField = await post({}, sessionBody({ userId: "someone-else" }));
  expect(unknownField.status()).toBe(400);
  expect(await unknownField.json()).toMatchObject({ error: { code: "VALIDATION_ERROR", issues: [expect.objectContaining({ message: expect.any(String) })] } });

  const huge = sessionBody({ description: "x".repeat(2 * 1024 * 1024) });
  expect((await post({}, huge)).status()).toBe(413);
  expect((await api.get("/api/v1/sessions/not-a-uuid")).status()).toBe(404);
  expect((await api.get("/api/v1/sessions?limit=1000")).status()).toBe(400);
  expect((await api.get("/api/v1/sessions?cursor=garbage")).status()).toBe(400);
});

test("retrying the same create is idempotent, and API data appears in the dashboard", async ({ page }) => {
  // page.request uses the context's headers, not the page's: without Origin, writes get 403.
  await page.context().setExtraHTTPHeaders({ origin: BASE_URL, "x-forwarded-for": randomIp() });
  const email = `api-${randomUUID()}@example.test`;
  expect((await page.request.post("/api/auth/sign-up/email", { data: { name: "Dash", email, password: "correct horse battery" } })).ok()).toBe(true);

  const id = randomUUID();
  const first = await page.request.post("/api/v1/sessions", { data: sessionBody({ id, name: "Created via API" }) });
  const retry = await page.request.post("/api/v1/sessions", { data: sessionBody({ id, name: "Created via API" }) });
  expect([first.status(), retry.status()]).toEqual([201, 200]);
  expect(await retry.json()).toEqual(await first.json());

  await page.goto("/app/sessions");
  const row = page.getByRole("list", { name: "Saved sessions" }).getByRole("listitem").filter({ hasText: "Created via API" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Web");
  await expect(row).toContainText("2 tabs");
});

test("writes are rate-limited per user with 429 and Retry-After; reads and other users are not", async ({ playwright }) => {
  const alice = await newApiUser(playwright.request);
  const bob = await newApiUser(playwright.request);

  // Rejected-before-auth requests must not consume Alice's budget.
  const anonymous = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL } });
  for (let i = 0; i < 5; i += 1) expect((await anonymous.post("/api/v1/sessions", { data: sessionBody() })).status()).toBe(401);
  for (let i = 0; i < 5; i += 1) {
    expect((await alice.post("/api/v1/sessions", { headers: { origin: "https://evil.test" }, data: sessionBody() })).status()).toBe(403);
  }

  // A burst of 35 writes mixing methods (deletes of unknown ids and creates with an invalid
  // body, so nothing changes): the limiter runs before the body is read, so all share one budget.
  const responses = await Promise.all(
    Array.from({ length: 35 }, (_, index) =>
      index % 5 === 0
        ? alice.post("/api/v1/sessions", { data: {} })
        : alice.delete(`/api/v1/sessions/${randomUUID()}?expectedVersion=1`),
    ),
  );
  const statuses = responses.map((response) => response.status());
  const allowed = statuses.filter((status) => status === 404 || status === 400).length;
  expect(allowed).toBeGreaterThanOrEqual(30);
  expect(allowed).toBeLessThanOrEqual(33); // tokens refill at 1/s while the burst is in flight
  expect(statuses.filter((status) => status === 429).length).toBe(35 - allowed);

  // Read Retry-After from a 429 inside the burst (a later request may already be allowed again).
  const limited = responses.find((response) => response.status() === 429)!;
  const retryAfter = Number(limited.headers()["retry-after"]);
  expect(retryAfter).toBeGreaterThanOrEqual(1);
  expect(await limited.json()).toMatchObject({ error: { code: "RATE_LIMITED", retryAfterSeconds: retryAfter } });

  expect((await alice.get("/api/v1/sessions")).status()).toBe(200);
  expect((await bob.post("/api/v1/sessions", { data: sessionBody() })).status()).toBe(201);

  await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000 + 200));
  expect((await alice.post("/api/v1/sessions", { data: sessionBody() })).status()).toBe(201);
});

test("reads are rate-limited per user too, separately from writes and from other users", async ({ playwright }) => {
  const alice = await newApiUser(playwright.request);
  const bob = await newApiUser(playwright.request);
  const anonymous = await playwright.request.newContext({ baseURL: BASE_URL });
  for (let i = 0; i < 5; i += 1) expect((await anonymous.get("/api/v1/sessions")).status()).toBe(401);

  // 130 reads at once: the 120 burst passes (a few more may refill at 2/s while in flight), the rest get 429.
  const responses = await Promise.all(Array.from({ length: 130 }, () => alice.get("/api/v1/sessions?limit=1")));
  const statuses = responses.map((response) => response.status());
  const allowed = statuses.filter((status) => status === 200).length;
  expect(allowed).toBeGreaterThanOrEqual(120);
  expect(allowed).toBeLessThan(130);
  expect(statuses.filter((status) => status === 429).length).toBe(130 - allowed);
  const limited = responses.find((response) => response.status() === 429)!;
  expect(Number(limited.headers()["retry-after"])).toBeGreaterThanOrEqual(1);
  expect(await limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });

  // Writes have their own budget, and Bob his.
  expect((await alice.post("/api/v1/sessions", { data: sessionBody() })).status()).toBe(201);
  expect((await bob.get("/api/v1/sessions")).status()).toBe(200);
});
