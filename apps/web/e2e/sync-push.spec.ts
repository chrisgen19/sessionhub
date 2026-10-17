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
