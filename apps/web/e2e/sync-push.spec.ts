import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createPrismaClient } from "@sessionhub/database/client";
import { BASE_URL } from "../playwright.config";
import { launchWithExtension } from "./extension";
import { randomIp, signUp } from "./pairing-flow";
import { captureAllWindows, connectExtension, readStore, sendCommand, turnOnSync } from "./sync-flow";

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
test.afterAll(async () => {
  await prisma.$disconnect();
});

/** Signs up over HTTP, confirms the email in the database and pairs a device: returns its credentials. */
const pairOverHttp = async (api: APIRequestContext) => {
  const email = `push-${randomUUID()}@example.test`;
  expect((await api.post("/api/auth/sign-up/email", { data: { name: "Pusher", email, password: "correct horse battery" } })).ok()).toBe(true);
  const user = await prisma.user.update({ where: { email }, data: { emailVerified: true } });
  const started = await (await api.post("/api/v1/pairing", { data: { installationId: randomUUID(), deviceName: "Chrome on Linux" } })).json();
  expect((await api.post("/api/v1/pairing/decision", { data: { userCode: started.userCode, decision: "approve" } })).ok()).toBe(true);
  const redeemed = await (await api.post("/api/v1/pairing/token", { data: { deviceCode: started.deviceCode } })).json();
  return { userId: user.id, deviceId: redeemed.device.id as string, bearer: { authorization: `Bearer ${redeemed.credentials.accessToken}` } };
};

const upsert = (entityId = randomUUID()) => ({
  clientOperationId: randomUUID(),
  entityType: "savedSession",
  entityId,
  action: "upsert",
  expectedVersion: 0,
  payload: { name: "From the HTTP test", windows: [{ tabs: [{ url: "https://a.test/", title: "A" }] }] },
});

test("push takes only this device's Bearer token and one operation per session, and answers repeats with the original result", async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL, "x-forwarded-for": randomIp() } });
  const { userId, deviceId, bearer } = await pairOverHttp(api);
  const create = upsert();
  const push = (operations: unknown[], options: { device?: string; headers?: Record<string, string> } = {}) =>
    api.post("/api/v1/sync/push", { headers: options.headers ?? bearer, data: { protocolVersion: 1, deviceId: options.device ?? deviceId, operations } });
  const code = async (response: Awaited<ReturnType<typeof push>>) => [response.status(), (await response.json()).error?.code];

  expect(await code(await push([create], { headers: {} }))).toEqual([401, "UNAUTHENTICATED"]);
  expect(await code(await push([create], { device: randomUUID() }))).toEqual([403, "DEVICE_MISMATCH"]);
  expect(await code(await push([create, { ...upsert(create.entityId) }]))).toEqual([400, "VALIDATION_ERROR"]);
  expect(await code(await push(Array.from({ length: 26 }, () => upsert())))).toEqual([400, "VALIDATION_ERROR"]);

  const first = await push([create]);
  expect([first.status(), first.headers()["cache-control"]]).toEqual([200, "no-store"]);
  const [accepted] = (await first.json()).results;
  expect(accepted).toMatchObject({ status: "accepted", clientOperationId: create.clientOperationId, serverVersion: 1, replayed: false });
  expect((await (await push([create])).json()).results).toEqual([{ ...accepted, replayed: true }]);
  expect(await prisma.savedSession.findUniqueOrThrow({ where: { id: create.entityId } })).toMatchObject({ userId, sourceDeviceId: deviceId, sourceDeviceName: "Chrome on Linux" });

  await prisma.user.update({ where: { id: userId }, data: { emailVerified: false } });
  expect(await code(await push([upsert()]))).toEqual([403, "EMAIL_NOT_CONFIRMED"]);
});

test("workspaces round-trip: created and assigned by a device, renamed on the web, and pulled back", async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL, "x-forwarded-for": randomIp() } });
  const { deviceId, bearer } = await pairOverHttp(api);
  const push = async (operations: unknown[]) =>
    (await (await api.post("/api/v1/sync/push", { headers: bearer, data: { protocolVersion: 1, deviceId, operations } })).json()).results as { status: string; code?: string }[];
  const [space, session] = [randomUUID(), randomUUID()];
  const createSpace = { clientOperationId: randomUUID(), entityType: "workspace", entityId: space, action: "upsert", expectedVersion: 0, payload: { name: "Client Alpha", color: "green" } };
  const assigned = { ...upsert(session), payload: { ...upsert().payload, workspaceId: space } };
  expect((await push([createSpace, assigned])).map((result) => result.status)).toEqual(["accepted", "accepted"]);

  // The website sees what the device uploaded (cookie API).
  const listed = (await (await api.get("/api/v1/workspaces")).json()).items as { id: string; name: string; sessionCount: number; version: number }[];
  expect(listed).toEqual([expect.objectContaining({ id: space, name: "Client Alpha", sessionCount: 1, version: 1 })]);
  expect((await (await api.get(`/api/v1/sessions/${session}`)).json()).workspaceId).toBe(space);

  // Renamed on the web: the device pulls the change, and a fresh bootstrap carries the workspace first.
  expect((await api.patch(`/api/v1/workspaces/${space}`, { data: { expectedVersion: 1, name: "Client Alpha (web)" } })).ok()).toBe(true);
  const pulled = (await (await api.get("/api/v1/sync/pull", { headers: bearer })).json()).changes as { entityType: string; entityId: string; version: number; payload: { name?: string } }[];
  expect(pulled.filter((change) => change.entityType === "workspace").map((change) => [change.entityId, change.version, change.payload.name])).toEqual([
    [space, 1, "Client Alpha"],
    [space, 2, "Client Alpha (web)"],
  ]);
  const boot = (await (await api.get("/api/v1/sync/bootstrap", { headers: bearer })).json()).items as { entityType: string; entityId: string }[];
  expect(boot.map((item) => [item.entityType, item.entityId])).toEqual([["workspace", space], ["savedSession", session]]);

  // Not deletable while it holds the session; unassign and delete in one push.
  const remove = { clientOperationId: randomUUID(), entityType: "workspace", entityId: space, action: "delete", expectedVersion: 2, payload: null };
  expect(await push([remove])).toEqual([expect.objectContaining({ status: "rejected", code: "WORKSPACE_NOT_EMPTY" })]);
  const unassign = { ...upsert(session), expectedVersion: 1, payload: { ...upsert().payload, workspaceId: null } };
  expect((await push([unassign, { ...remove, clientOperationId: randomUUID() }])).map((result) => result.status)).toEqual(["accepted", "accepted"]);
  expect((await (await api.get("/api/v1/workspaces")).json()).items).toEqual([]);
});

test("the real extension uploads what the user chose when turning sync on, then edits, deletes and new saves", async () => {
  const { context, extensionId, close } = await launchWithExtension({ "x-forwarded-for": randomIp() });
  try {
    const { email } = await signUp(context);
    const manager = await connectExtension(context, extensionId);
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { devices: true } });

    // Saved before sync existed: local only until the user picks it in the upload preview.
    const sessionId = await captureAllWindows(manager);
    await turnOnSync(manager, extensionId, 1);
    const server = (id: string) => prisma.savedSession.findUnique({ where: { id } });
    await expect.poll(async () => (await server(sessionId))?.version, { timeout: 15_000 }).toBe(1);
    expect(await server(sessionId)).toMatchObject({ userId: user.id, sourceDeviceId: user.devices[0]!.id });
    await expect(manager.getByRole("region", { name: "Sync" }).getByTitle(/./).first()).toHaveText("Synced", { timeout: 15_000 });

    // Ordinary commands: the worker uploads on its own afterwards.
    const rename = await sendCommand(manager, { type: "session.rename", sessionId, expectedVersion: 1, name: "Renamed in the extension" });
    expect(rename).toEqual({ ok: true, data: { version: 2 } });
    await expect.poll(async () => (await server(sessionId))?.name, { timeout: 15_000 }).toBe("Renamed in the extension");
    await sendCommand(manager, { type: "session.delete", sessionId });
    await expect.poll(async () => (await server(sessionId))?.deletedAt !== null, { timeout: 15_000 }).toBe(true);
    expect((await server(sessionId))?.version).toBe(3);

    // With sync on, a new save goes to the account by itself (docs/USER_FLOWS.md Flow 2).
    const later = await captureAllWindows(manager);
    await expect.poll(async () => (await server(later))?.userId, { timeout: 15_000 }).toBe(user.id);

    expect(await prisma.syncOperationReceipt.count({ where: { userId: user.id, resultStatus: "accepted" } })).toBe(4);
    await expect.poll(async () => (await readStore(manager, "outbox")).length, { timeout: 15_000 }).toBe(0);
  } finally {
    await close();
  }
});
