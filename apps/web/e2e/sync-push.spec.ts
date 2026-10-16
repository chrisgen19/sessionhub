import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createPrismaClient } from "@sessionhub/database/client";
import { BASE_URL } from "../playwright.config";
import { launchWithExtension } from "./extension";
import { randomIp, signUp } from "./pairing-flow";
import { connectExtension, enableSync, localSession, readStore, sendCommand } from "./sync-flow";

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

test("the real extension uploads a queued session once, then pushes a rename and a delete made through its commands", async () => {
  const { context, extensionId, close } = await launchWithExtension({ "x-forwarded-for": randomIp() });
  try {
    const { email } = await signUp(context);
    const manager = await connectExtension(context, extensionId);
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { devices: true } });

    const session = localSession("Uploaded from the extension");
    await enableSync(manager, `account:${user.id}`, session);

    expect(await sendCommand(manager, { type: "sync.now" })).toMatchObject({ ok: true, data: { push: { status: "done", accepted: 1, conflicts: 0, rejected: 0, remaining: 0 } } });
    expect(await prisma.savedSession.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({
      userId: user.id,
      name: "Uploaded from the extension",
      version: 1,
      tabCount: 2,
      sourceDeviceId: user.devices[0]!.id,
    });

    // Ordinary commands: the worker uploads on its own afterwards.
    const rename = await manager.evaluate((id) => chrome.runtime.sendMessage({ type: "session.rename", sessionId: id, expectedVersion: 1, name: "Renamed in the extension" }), session.id);
    expect(rename).toEqual({ ok: true, data: { version: 2 } });
    const server = () => prisma.savedSession.findUniqueOrThrow({ where: { id: session.id } });
    await expect.poll(async () => (await server()).name, { timeout: 15_000 }).toBe("Renamed in the extension");
    await manager.evaluate((id) => chrome.runtime.sendMessage({ type: "session.delete", sessionId: id }), session.id);
    await expect.poll(async () => (await server()).deletedAt !== null, { timeout: 15_000 }).toBe(true);

    expect(await prisma.savedSession.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({ version: 3 });
    expect(await prisma.syncOperationReceipt.count({ where: { userId: user.id, resultStatus: "accepted" } })).toBe(3);
    expect(await readStore(manager, "outbox")).toEqual([]);
  } finally {
    await close();
  }
});
