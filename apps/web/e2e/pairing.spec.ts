import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createPrismaClient } from "@sessionhub/database/client";
import { BASE_URL } from "../playwright.config";
import { launchWithExtension } from "./extension";
import { waitForEmail } from "./mailpit";

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
test.afterAll(async () => {
  await prisma.$disconnect();
});

const randomIp = () => {
  const [a, b, c] = randomBytes(3);
  return `10.${a}.${b}.${c}`;
};

/** Signs up in the extension's own profile, so the approve page sees the session cookie. */
const signUp = async (context: BrowserContext, { confirm = true } = {}) => {
  const page = await context.newPage();
  const email = `pair-${randomUUID()}@example.test`;
  await page.goto(`${BASE_URL}/signup`);
  await page.getByLabel("Name").fill("Pat Pairing");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app$/);
  if (confirm) {
    const { link } = await waitForEmail(email, /Confirm your email/);
    await page.goto(link!);
    await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
  }
  return { page, email };
};

const openAccountView = async (context: BrowserContext, extensionId: string) => {
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html#view=account`);
  await expect(manager.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  return manager;
};

/** Clicks Connect account and returns the approve tab the extension opened, plus the code it shows. */
const startConnect = async (context: BrowserContext, manager: Page) => {
  const approveTab = context.waitForEvent("page");
  await manager.getByRole("button", { name: "Connect account" }).click();
  const code = (await manager.getByLabel("Connection code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  const tab = await approveTab;
  await tab.waitForLoadState();
  expect(tab.url()).toBe(`${BASE_URL}/app/pair?code=${code}`);
  return { tab, code };
};

test("pair, see the device on the web, revoke from the web, pair again, disconnect from the extension", async () => {
  const { context, extensionId, close } = await launchWithExtension({ "x-forwarded-for": randomIp() });
  try {
    const { email } = await signUp(context);
    const manager = await openAccountView(context, extensionId);
    await expect(manager.getByText("It doesn't upload any sessions")).toBeVisible();

    const { tab, code } = await startConnect(context, manager);
    const request = tab.getByRole("region", { name: "Connection request" });
    await expect(request).toContainText(code);
    await expect(request).toContainText(`use your account as ${email}`);
    await request.getByRole("button", { name: "Connect this browser" }).click();
    await expect(request.getByRole("status")).toContainText("Connected.");

    // The extension's next poll (every 5 s) picks up the approval.
    await expect(manager.getByText("Connected", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(manager.getByText(`Pat Pairing (${email})`)).toBeVisible();
    await expect(manager.getByText("Off. Nothing is uploaded yet.")).toBeVisible();

    // Stored hashed on the server; the device appears on the web.
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { devices: true, deviceCredentials: true } });
    expect(user.devices).toHaveLength(1);
    expect(user.deviceCredentials[0]?.accessTokenHash).toMatch(/^[0-9a-f]{64}$/);
    await tab.goto(`${BASE_URL}/app/devices`);
    const row = tab.getByRole("list", { name: "Devices" }).getByRole("listitem");
    await expect(row).toContainText(user.devices[0]!.displayName);
    await expect(row).toContainText("last seen");

    // Revoke from the website: the extension notices on its next check and keeps local data.
    await row.getByRole("button", { name: "Disconnect" }).click();
    await tab.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
    await expect(row).toContainText("Access revoked");
    await manager.reload();
    await expect(manager.getByRole("alert")).toContainText("This browser was disconnected from your account");
    await expect(manager.getByRole("button", { name: "Connect account" })).toBeVisible();

    // Pair again: same device row, access restored.
    const again = await startConnect(context, manager);
    await again.tab.getByRole("button", { name: "Connect this browser" }).click();
    await expect(manager.getByText("Connected", { exact: true })).toBeVisible({ timeout: 15_000 });
    const devices = await prisma.device.findMany({ where: { userId: user.id } });
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ revokedAt: null, authCredentialVersion: 3 });

    // Disconnect from the extension revokes on the server too.
    await manager.getByRole("button", { name: "Disconnect" }).click();
    await expect(manager.getByText("Disconnected. Sessions saved in this browser are still here.")).toBeVisible();
    await expect.poll(async () => (await prisma.device.findFirstOrThrow({ where: { userId: user.id } })).revokedAt).not.toBeNull();
  } finally {
    await close();
  }
});

test("declining on the website, an unconfirmed email and an unknown code connect nothing", async () => {
  const { context, extensionId, close } = await launchWithExtension({ "x-forwarded-for": randomIp() });
  try {
    const { page, email } = await signUp(context, { confirm: false });
    const manager = await openAccountView(context, extensionId);
    const { tab } = await startConnect(context, manager);
    await expect(tab.getByRole("region", { name: "Connection request" }).getByRole("alert")).toContainText("Confirm your email first");
    await expect(tab.getByRole("button", { name: "Connect this browser" })).toHaveCount(0);

    // The API refuses too, not just the page.
    const userCode = new URL(tab.url()).searchParams.get("code");
    const refused = await page.request.post(`${BASE_URL}/api/v1/pairing/decision`, { headers: { origin: BASE_URL }, data: { userCode, decision: "approve" } });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "EMAIL_NOT_CONFIRMED" } });

    const { link } = await waitForEmail(email, /Confirm your email/);
    await page.goto(link!);
    await tab.reload();
    await tab.getByRole("button", { name: "Decline" }).click();
    await expect(tab.getByRole("status")).toContainText("Declined.");
    await expect(manager.getByText("The connection was declined on the website. Nothing was connected.")).toBeVisible({ timeout: 15_000 });
    await expect(manager.getByRole("button", { name: "Connect account" })).toBeVisible();
    expect(await prisma.device.count({ where: { user: { email } } })).toBe(0);

    await tab.goto(`${BASE_URL}/app/pair?code=BCDF-GHJK`);
    await expect(tab.getByText("No pending request with that code")).toBeVisible();
    await tab.setViewportSize({ width: 375, height: 800 });
    expect(await tab.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  } finally {
    await close();
  }
});

test("device endpoints accept only a valid Bearer token, never the web session cookie", async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL, "x-forwarded-for": randomIp() } });
  expect((await api.post("/api/auth/sign-up/email", { data: { name: "C", email: `c-${randomUUID()}@example.test`, password: "correct horse battery" } })).ok()).toBe(true);
  const withCookie = await api.get("/api/v1/devices/me");
  expect(withCookie.status()).toBe(401);
  const forged = await api.get("/api/v1/devices/me", { headers: { authorization: `Bearer shd_at_${"A".repeat(43)}` } });
  expect(forged.status()).toBe(401);
  expect(forged.headers()["www-authenticate"]).toBe('Bearer error="invalid_token"');
  expect(await forged.json()).toMatchObject({ error: { code: "INVALID_TOKEN" } });
  const badRefresh = await api.post("/api/v1/devices/token", { data: { refreshToken: `shd_rt_${"A".repeat(43)}` } });
  expect([badRefresh.status(), badRefresh.headers()["cache-control"]]).toEqual([401, "no-store"]);
  const badStart = await api.post("/api/v1/pairing", { data: { installationId: "nope", deviceName: "<script>" } });
  expect(badStart.status()).toBe(400);
});
