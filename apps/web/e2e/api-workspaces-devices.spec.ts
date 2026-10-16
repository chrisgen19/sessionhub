import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type APIRequest } from "@playwright/test";
import { createPrismaClient } from "@sessionhub/database/client";
import { BASE_URL } from "../playwright.config";

// Devices are seeded directly: registration arrives with extension pairing (M4).
const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
test.afterAll(async () => {
  await prisma.$disconnect();
});

/** A signed-up API client with its own cookie jar, IP and rate-limit bucket. */
const newApiUser = async (playwright: APIRequest) => {
  const [a, b, c] = randomBytes(3);
  const api = await playwright.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL, "x-forwarded-for": `10.${a}.${b}.${c}` } });
  const email = `ws-${randomUUID()}@example.test`;
  expect((await api.post("/api/auth/sign-up/email", { data: { name: "WS", email, password: "correct horse battery" } })).ok()).toBe(true);
  const { id: userId } = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return { api, userId };
};

test("workspaces require a session and a same-origin request", async ({ playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL } });
  expect((await anonymous.get("/api/v1/workspaces")).status()).toBe(401);
  expect((await anonymous.get("/api/v1/devices")).status()).toBe(401);
  expect((await anonymous.post("/api/v1/workspaces", { data: { name: "X" } })).status()).toBe(401);
  const { api } = await newApiUser(playwright.request);
  const crossSite = await api.post("/api/v1/workspaces", { headers: { origin: "https://evil.test" }, data: { name: "X" } });
  expect(await crossSite.json()).toMatchObject({ error: { code: "FORBIDDEN_ORIGIN" } });
});

test("workspace lifecycle over HTTP: create, retry, list, update, conflict, not-empty delete, tombstone", async ({ playwright }) => {
  const { api } = await newApiUser(playwright.request);
  const id = randomUUID();
  const created = await api.post("/api/v1/workspaces", { data: { id, name: "  Client Alpha  ", color: "blue", icon: "briefcase" } });
  expect(created.status()).toBe(201);
  expect(created.headers().location).toBe(`/api/v1/workspaces/${id}`);
  const workspace = await created.json();
  expect(workspace).toMatchObject({ id, name: "Client Alpha", color: "blue", icon: "briefcase", version: 1, position: 0, description: null });
  const retry = await api.post("/api/v1/workspaces", { data: { id, name: "Client Alpha", color: "blue", icon: "briefcase" } });
  expect([retry.status(), await retry.json()]).toEqual([200, workspace]);

  const session = await (await api.post("/api/v1/sessions", { data: { name: "In Alpha", workspaceId: id, windows: [{ tabs: [{ url: "https://a.test/" }] }] } })).json();
  expect(await (await api.get("/api/v1/workspaces")).json()).toEqual({ items: [{ ...workspace, sessionCount: 1 }] });

  const updated = await api.patch(`/api/v1/workspaces/${id}`, { data: { expectedVersion: 1, name: "Alpha", position: 3 } });
  expect(await updated.json()).toMatchObject({ name: "Alpha", position: 3, version: 2 });
  const stale = await api.patch(`/api/v1/workspaces/${id}`, { data: { expectedVersion: 1, name: "Stale" } });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ error: { code: "VERSION_CONFLICT", serverVersion: 2, serverState: { name: "Alpha" } } });

  const notEmpty = await api.delete(`/api/v1/workspaces/${id}?expectedVersion=2`);
  expect(notEmpty.status()).toBe(409);
  expect(await notEmpty.json()).toMatchObject({ error: { code: "WORKSPACE_NOT_EMPTY", sessionCount: 1 } });
  expect((await api.patch(`/api/v1/sessions/${session.id}`, { data: { expectedVersion: 1, workspaceId: null } })).ok()).toBe(true);
  const deleted = await api.delete(`/api/v1/workspaces/${id}?expectedVersion=2`);
  expect(deleted.status()).toBe(200);
  const tombstone = await deleted.json();
  expect(tombstone).toMatchObject({ id, version: 3 });
  expect(await (await api.delete(`/api/v1/workspaces/${id}?expectedVersion=2`)).json()).toEqual(tombstone);
  expect(await (await api.get("/api/v1/workspaces")).json()).toEqual({ items: [] });
  const intoDeleted = await api.post("/api/v1/sessions", { data: { name: "X", workspaceId: id, windows: [{ tabs: [{ url: "https://a.test/" }] }] } });
  expect(intoDeleted.status()).toBe(422);
});

test("workspace input is validated and other users get 404", async ({ playwright }) => {
  const alice = await newApiUser(playwright.request);
  const bob = await newApiUser(playwright.request);
  for (const data of [{ name: "" }, { name: "x".repeat(121) }, { name: "A", icon: "<svg>" }, { name: "A", color: "magenta" }, { name: "A", userId: bob.userId }]) {
    const response = await alice.api.post("/api/v1/workspaces", { data });
    expect(response.status(), JSON.stringify(data).slice(0, 60)).toBe(400);
  }
  expect((await alice.api.patch(`/api/v1/workspaces/${randomUUID()}`, { data: { expectedVersion: 1 } })).status()).toBe(400);
  const { id } = await (await alice.api.post("/api/v1/workspaces", { data: { name: "Private" } })).json();
  expect((await bob.api.patch(`/api/v1/workspaces/${id}`, { data: { expectedVersion: 1, name: "Pwned" } })).status()).toBe(404);
  expect((await bob.api.delete(`/api/v1/workspaces/${id}?expectedVersion=1`)).status()).toBe(404);
  expect((await bob.api.patch("/api/v1/workspaces/not-a-uuid", { data: { expectedVersion: 1, name: "X" } })).status()).toBe(404);
  expect(await (await bob.api.get("/api/v1/workspaces")).json()).toEqual({ items: [] });
  expect((await (await alice.api.get("/api/v1/workspaces")).json()).items[0]).toMatchObject({ id, name: "Private", version: 1 });
});

test("devices: list, rename and idempotent revoke over HTTP; other users get 404", async ({ playwright }) => {
  const alice = await newApiUser(playwright.request);
  const bob = await newApiUser(playwright.request);
  const device = await prisma.device.create({
    data: { userId: alice.userId, installationId: randomUUID(), displayName: "Windows Desktop", browser: "chrome", platform: "windows", lastSeenAt: new Date() },
  });

  const { items } = await (await alice.api.get("/api/v1/devices")).json();
  expect(items).toEqual([expect.objectContaining({ id: device.id, displayName: "Windows Desktop", revokedAt: null })]);
  expect(items[0]).not.toHaveProperty("installationId");

  const renamed = await alice.api.patch(`/api/v1/devices/${device.id}`, { data: { displayName: "  Work PC " } });
  expect(await renamed.json()).toMatchObject({ displayName: "Work PC" });
  expect((await alice.api.patch(`/api/v1/devices/${device.id}`, { data: { displayName: "" } })).status()).toBe(400);

  const revoked = await (await alice.api.post(`/api/v1/devices/${device.id}/revoke`)).json();
  expect(revoked.revokedAt).not.toBeNull();
  expect(await (await alice.api.post(`/api/v1/devices/${device.id}/revoke`)).json()).toEqual(revoked);
  expect((await prisma.device.findUniqueOrThrow({ where: { id: device.id } })).authCredentialVersion).toBe(2);

  expect((await bob.api.patch(`/api/v1/devices/${device.id}`, { data: { displayName: "Pwned" } })).status()).toBe(404);
  expect((await bob.api.post(`/api/v1/devices/${randomUUID()}/revoke`)).status()).toBe(404);
  expect((await bob.api.post(`/api/v1/devices/${device.id}/revoke`, { headers: { origin: "https://evil.test" } })).status()).toBe(403);
  expect(await (await bob.api.get("/api/v1/devices")).json()).toEqual({ items: [] });
});
