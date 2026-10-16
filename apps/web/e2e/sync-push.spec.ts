import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createPrismaClient } from "@sessionhub/database/client";
import { BASE_URL } from "../playwright.config";
import { launchWithExtension } from "./extension";
import { openAccountView, randomIp, signUp, startConnect } from "./pairing-flow";

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

/** A valid local session record, as the extension stores it. */
const localSession = () => {
  const now = new Date().toISOString();
  const tab = (url: string, sortOrder: number) => ({ id: randomUUID(), title: url, url, pinned: false, sortOrder, groupId: null, eligibility: "restorable" });
  return {
    id: randomUUID(),
    schemaVersion: 1,
    name: "Uploaded from the extension",
    createdAt: now,
    updatedAt: now,
    sourceDeviceId: randomUUID(),
    sourceDeviceName: "This browser",
    version: 1,
    windows: [{ id: randomUUID(), sortOrder: 0, groups: [], tabs: [tab("https://a.test/", 0), tab("https://b.test/", 1)] }],
  };
};

test("the real extension uploads a queued session once, then pushes a rename and a delete made through its commands", async () => {
  const { context, extensionId, close } = await launchWithExtension({ "x-forwarded-for": randomIp() });
  try {
    const { email } = await signUp(context);
    const manager = await openAccountView(context, extensionId);
    const { tab } = await startConnect(context, manager);
    await tab.getByRole("button", { name: "Connect this browser" }).click();
    await expect(manager.getByText("Connected", { exact: true })).toBeVisible({ timeout: 15_000 });
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { devices: true } });

    // Stand-in for the upload preview (a later slice): the user picked this session for the account
    // and turned sync on, so it sits in the account's scope with a queued create.
    const session = localSession();
    await manager.evaluate(
      ({ scope, session, operationId, now }) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open("sessionhub");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction(["sessions", "outbox", "syncState"], "readwrite");
            tx.objectStore("sessions").put({ ...session, scope, sync: { serverVersion: null, state: "pending" } });
            tx.objectStore("outbox").add({ id: operationId, scope, entityType: "savedSession", entityId: session.id, action: "upsert", expectedVersion: 0, payload: session, status: "queued", createdAt: now, updatedAt: now, attempts: 0, nextAttemptAt: null, lastError: null });
            tx.objectStore("syncState").put({ scope, enabledAt: now, cursor: null, lastSyncAt: null, lastError: null, failures: 0, nextAttemptAt: null });
            tx.oncomplete = () => {
              open.result.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      { scope: `account:${user.id}`, session, operationId: randomUUID(), now: new Date().toISOString() },
    );

    const pushed = await manager.evaluate(() => chrome.runtime.sendMessage({ type: "sync.pushNow" }));
    expect(pushed).toEqual({ ok: true, data: { status: "done", accepted: 1, conflicts: 0, rejected: 0, remaining: 0 } });
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
    const outboxCount = await manager.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open("sessionhub");
          open.onsuccess = () => {
            const count = open.result.transaction("outbox").objectStore("outbox").count();
            count.onsuccess = () => {
              open.result.close();
              resolve(count.result);
            };
          };
        }),
    );
    expect(outboxCount).toBe(0);
  } finally {
    await close();
  }
});
