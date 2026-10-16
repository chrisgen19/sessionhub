import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createPrismaClient } from "@sessionhub/database/client";

// Seeds rows directly in the test database: sync doesn't exist yet, so this is the only way
// to exercise lists with data. Each test uses fresh users.
const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
test.afterAll(async () => {
  await prisma.$disconnect();
});

const password = "correct horse battery";

test.beforeEach(async ({ page }) => {
  const [a, b, c] = randomBytes(3);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.${a}.${b}.${c}` });
});

const signUp = async (page: Page, name = "Chris Tester") => {
  const email = `dash-${randomUUID()}@example.test`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app$/);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { email, userId: user.id };
};

const seedSessions = (userId: string, names: string[]) =>
  prisma.savedSession.createMany({
    data: names.map((name, index) => ({
      userId,
      name,
      sourceDeviceName: "Windows Desktop",
      tabCount: 10 + index,
      windowCount: 2,
      updatedAt: new Date(Date.now() - index * 3_600_000),
    })),
  });

test("signed-out deep links survive sign-in; forged cookies are rejected by the server check", async ({ page, context }) => {
  const { email } = await signUp(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/app/devices");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fdevices$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\/devices$/);

  await context.clearCookies();
  await context.addCookies([{ name: "better-auth.session_token", value: "forged.value", url: page.url() }]);
  await page.goto("/app/settings");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("shell navigation and honest empty states for a new account", async ({ page }) => {
  await signUp(page);
  const nav = page.getByRole("navigation", { name: "Dashboard" }).first();
  await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Welcome, Chris" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Cloud sync isn't available yet.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Summary" }).getByText("0")).toHaveCount(3);
  await expect(page.getByText("No synced sessions yet")).toBeVisible();

  await nav.getByRole("link", { name: "Saved sessions" }).click();
  await expect(page).toHaveURL(/\/app\/sessions$/);
  await expect(nav.getByRole("link", { name: "Saved sessions" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("No synced sessions yet")).toBeVisible();

  await nav.getByRole("link", { name: "Devices" }).click();
  await expect(page.getByText("No devices connected yet")).toBeVisible();

  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("region", { name: "Sync" })).toContainText("Off.");
});

test("lists and search show only the signed-in user's sessions", async ({ page }) => {
  const { userId } = await signUp(page);
  const other = await prisma.user.create({ data: { id: `user_${randomUUID()}`, name: "Other", email: `${randomUUID()}@example.test` } });
  await seedSessions(userId, ["Frontend research", "Client Alpha review", "Weekend reading"]);
  await seedSessions(other.id, ["Other person's private research"]);

  await page.goto("/app");
  const summary = page.getByRole("region", { name: "Summary" });
  await expect(summary).toContainText("3");
  await expect(summary).toContainText("33");
  const recent = page.getByRole("list", { name: "Saved sessions" });
  await expect(recent.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByText("Other person's private research")).toHaveCount(0);

  await page.keyboard.press("Control+k");
  const search = page.getByRole("searchbox", { name: "Search saved sessions" });
  await expect(search).toBeFocused();
  await search.fill("research");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/app\/sessions\?q=research$/);
  await expect(page.getByRole("searchbox", { name: "Search saved sessions" })).toHaveValue("research");
  await expect(page.getByRole("list", { name: "Saved sessions" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("Frontend research")).toBeVisible();
  await expect(page.getByText("Other person's private research")).toHaveCount(0);

  await page.goto("/app/sessions?q=nothing-matches-this");
  await expect(page.getByText("No sessions match your search")).toBeVisible();
});

test("devices show last seen and revoked state, never 'online'", async ({ page }) => {
  const { userId } = await signUp(page);
  await prisma.device.createMany({
    data: [
      { userId, installationId: randomUUID(), displayName: "Windows Desktop", browser: "Chrome", platform: "Windows", lastSeenAt: new Date(Date.now() - 5 * 60_000) },
      { userId, installationId: randomUUID(), displayName: "Old MacBook", browser: "Chrome", platform: "macOS", lastSeenAt: new Date(Date.now() - 3 * 86_400_000), revokedAt: new Date() },
    ],
  });
  await page.goto("/app/devices");
  const list = page.getByRole("list", { name: "Devices" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByRole("listitem").first()).toContainText("Windows Desktop");
  await expect(list).toContainText("last seen 5m ago");
  await expect(list.getByRole("listitem").nth(1)).toContainText("Access revoked");
  await expect(page.getByText(/online/i)).toHaveCount(0);
});

test("mobile: bottom navigation, no sidebar, no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  const { userId } = await signUp(page);
  await seedSessions(userId, ["A session with a really long name that should truncate nicely on small screens"]);
  for (const path of ["/app", "/app/sessions", "/app/devices", "/app/settings"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  }
  const bottom = page.getByRole("navigation", { name: "Dashboard" }).last();
  await expect(bottom).toBeVisible();
  await bottom.getByRole("link", { name: "Sessions" }).click();
  await expect(page).toHaveURL(/\/app\/sessions$/);
  await expect(page.getByRole("complementary")).toBeHidden();
});
