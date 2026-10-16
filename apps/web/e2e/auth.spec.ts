import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const password = "correct horse battery";

// Better Auth rate-limits sign-in/up per client IP in production. Give every test (and every
// repeat) its own random private IP so tests can't trip each other's limit.
test.beforeEach(async ({ page }) => {
  const [a, b, c] = randomBytes(3);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.${a}.${b}.${c}` });
});
const newEmail = () => `e2e-${randomUUID()}@example.test`;

/** The form's own alert (Next.js also renders an empty role="alert" route announcer). */
const formAlert = (page: Page) => page.getByRole("main").getByRole("alert");

const signUp = async (page: Page, email: string, name = "Chris Tester", pass = password) => {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pass);
  await page.getByRole("button", { name: "Create account" }).click();
};

/** Signs out and waits until the redirect home has happened (the session cookie is gone). */
const signOut = async (page: Page) => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
};

const signIn = async (page: Page, email: string, pass = password, path = "/login") => {
  await page.goto(path);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pass);
  await page.getByRole("button", { name: "Sign in" }).click();
};

test("sign up, sign out, protected page, wrong password, sign in", async ({ page, context }) => {
  const email = newEmail();
  await signUp(page, email);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Signed in" })).toBeVisible();
  await expect(page.getByText(`Chris Tester · ${email}`)).toBeVisible();
  const sessionCookie = (await context.cookies()).find((cookie) => cookie.name.includes("session_token"));
  expect(sessionCookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });

  await signOut(page);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)app$/);

  await signIn(page, email, "not the password");
  await expect(formAlert(page)).toHaveText("Email or password is incorrect.");
  await expect(page.getByLabel("Email")).toHaveValue(email);

  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Signed-in users skip the auth pages.
  await page.goto("/login");
  await expect(page).toHaveURL(/\/app$/);
});

test("validation and duplicate accounts are explained without creating anything", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email, "Short Pass", "short");
  await expect(page.getByText("Use at least 10 characters")).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/signup$/);

  await signUp(page, email);
  await expect(page).toHaveURL(/\/app$/);
  await signOut(page);

  await signUp(page, email, "Someone Else");
  await expect(formAlert(page)).toHaveText(/already exists/);
});

test("post-login redirects stay on this site", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  await signOut(page);

  await signIn(page, email, password, "/login?next=//evil.test/steal");
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/app$/);
});

test("auth pages fit a 375px screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  for (const path of ["/signup", "/login", "/"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  }
});

test("repeated wrong passwords are rate-limited with a clear message", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  await signOut(page);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await signIn(page, email, `wrong password ${attempt}`);
    await expect(formAlert(page)).toHaveText("Email or password is incorrect.");
  }
  await signIn(page, email, "wrong password again");
  await expect(formAlert(page)).toHaveText("Too many attempts. Wait a minute and try again.");
});

