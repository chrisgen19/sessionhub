import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { listEmails, waitForEmail } from "./mailpit";

const password = "correct horse battery";
const newPassword = "a different horse 42";

/** A fresh page with its own cookie jar and client IP (Better Auth limits auth emails to 3 per minute per IP). */
const newPage = async (browser: Browser) => {
  const [a, b, c] = randomBytes(3);
  const context = await browser.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { "x-forwarded-for": `10.${a}.${b}.${c}` } });
  return context.newPage();
};

const signUp = async (page: Page, email: string, name = "Mail Tester") => {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app$/);
};

const signIn = async (page: Page, email: string, pass: string) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pass);
  await page.getByRole("button", { name: "Sign in" }).click();
};

const formAlert = (page: Page) => page.getByRole("main").getByRole("alert");
const newEmail = () => `mail-${randomUUID()}@example.test`;

test("sign-up sends a confirmation email; the link confirms it and the banner goes away", async ({ browser }) => {
  const page = await newPage(browser);
  const email = newEmail();
  await signUp(page, email, "Ana <b>Bold</b>");
  const banner = page.getByRole("region", { name: "Confirm your email" });
  await expect(banner).toContainText(`We sent a link to ${email}`);

  const message = await waitForEmail(email, /Confirm your email/);
  expect(message.From.Address).toBe("no-reply@sessionhub.test");
  expect(message.Text).toContain("Hi Ana <b>Bold</b>,");
  expect(message.HTML).not.toContain("<b>Bold</b>");
  expect(message.link).toMatch(new RegExp(`^${BASE_URL}/api/auth/verify-email\\?token=`));

  await page.goto(message.link!);
  await expect(page).toHaveURL(/\/email-verified$/);
  await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
  await page.getByRole("link", { name: "Go to your dashboard" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ana");
  await expect(banner).toHaveCount(0);
  await page.goto("/app/settings");
  await expect(page.getByText("Email status")).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
});

test("a tampered confirmation link is refused, and the banner can send a new one", async ({ browser }) => {
  const page = await newPage(browser);
  const email = newEmail();
  await signUp(page, email);
  const { link } = await waitForEmail(email, /Confirm your email/);

  await page.goto(link!.replace(/token=[^&]+/, "token=not-a-real-token"));
  await expect(page).toHaveURL(/\/email-verified\?error=/);
  await expect(page.getByRole("heading", { name: "This link doesn't work anymore" })).toBeVisible();
  await page.getByRole("link", { name: "Go to Settings" }).click();
  await expect(page.getByText("Not confirmed")).toBeVisible();

  await page.getByRole("region", { name: "Confirm your email" }).getByRole("button", { name: "Resend link" }).click();
  await expect(page.getByRole("region", { name: "Confirm your email" }).getByRole("status")).toHaveText(`Sent. Check ${email}.`);
  await waitForEmail(email, /Confirm your email/, { count: 2 });
});

test("password reset: same answer for unknown emails, one-time link, all sessions signed out", async ({ browser }) => {
  const page = await newPage(browser);
  const email = newEmail();
  await signUp(page, email);
  const otherBrowser = await newPage(browser);
  await signIn(otherBrowser, email, password);
  await expect(otherBrowser).toHaveURL(/\/app$/);

  const visitor = await newPage(browser);
  const unknown = newEmail();
  for (const address of [unknown, email]) {
    await visitor.goto("/login");
    await visitor.getByRole("link", { name: "Forgot password?" }).click();
    await visitor.getByLabel("Email").fill(address);
    await visitor.getByRole("button", { name: "Send reset link" }).click();
    await expect(visitor.getByRole("status")).toContainText(`If there's an account for ${address}, we've sent it a link`);
  }
  const reset = await waitForEmail(email, /Reset your SessionHub password/);
  expect(reset.link).toMatch(new RegExp(`^${BASE_URL}/api/auth/reset-password/[^?]+\\?callbackURL=%2Freset-password$`));
  expect(await listEmails(unknown)).toEqual([]);

  const response = await visitor.goto(reset.link!);
  await expect(visitor).toHaveURL(/\/reset-password\?token=/);
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await visitor.getByLabel("New password", { exact: true }).fill(newPassword);
  await visitor.getByLabel("Confirm new password").fill("not the same password");
  await visitor.getByRole("button", { name: "Change password" }).click();
  await expect(visitor.getByText("The passwords don't match")).toBeVisible();
  await visitor.getByLabel("Confirm new password").fill(newPassword);
  await visitor.getByRole("button", { name: "Change password" }).click();
  await expect(visitor).toHaveURL(/\/login\?reset=1$/);
  await expect(visitor.getByRole("status")).toContainText("Password changed");

  // Every existing session was revoked, and the security notice was sent.
  for (const signedIn of [page, otherBrowser]) {
    await signedIn.goto("/app/settings");
    await expect(signedIn).toHaveURL(/\/login\?next=/);
  }
  await waitForEmail(email, /Your SessionHub password was changed/);

  // The link works once; the old password no longer does.
  await visitor.goto(reset.link!);
  await expect(visitor).toHaveURL(/\/reset-password\?error=INVALID_TOKEN$/);
  await expect(visitor.getByRole("heading", { name: "This link doesn't work anymore" })).toBeVisible();
  await signIn(visitor, email, password);
  await expect(formAlert(visitor)).toHaveText("Email or password is incorrect.");
  await signIn(otherBrowser, email, newPassword);
  await expect(otherBrowser).toHaveURL(/\/app$/);
});

test("a forged reset token is rejected by the API without changing anything", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto("/reset-password?token=forgedtoken123456");
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(formAlert(page)).toHaveText("This reset link has expired or was already used. Ask for a new one.");
  await page.goto("/reset-password?token=%3Cscript%3E");
  await expect(page.getByRole("heading", { name: "This link doesn't work anymore" })).toBeVisible();
});

test("change password in Settings signs out other browsers but keeps this one", async ({ browser }) => {
  const page = await newPage(browser);
  const email = newEmail();
  await signUp(page, email);
  const otherBrowser = await newPage(browser);
  await signIn(otherBrowser, email, password);
  await expect(otherBrowser).toHaveURL(/\/app$/);

  await page.goto("/app/settings");
  const form = page.getByRole("form", { name: "Change password" });
  await form.getByLabel("Current password").fill("wrong password 123");
  await form.getByLabel("New password", { exact: true }).fill(newPassword);
  await form.getByLabel("Confirm new password").fill(newPassword);
  await form.getByRole("button", { name: "Change password" }).click();
  await expect(form.getByRole("alert")).toHaveText("Your current password is incorrect.");

  await form.getByLabel("Current password").fill(password);
  await form.getByRole("button", { name: "Change password" }).click();
  await expect(form.getByRole("status")).toHaveText("Password changed. Other browsers signed in to this account were signed out.");
  await expect(form.getByLabel("Current password")).toHaveValue("");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await otherBrowser.goto("/app/settings");
  await expect(otherBrowser).toHaveURL(/\/login/);
  await signIn(otherBrowser, email, newPassword);
  await expect(otherBrowser).toHaveURL(/\/app$/);
});

test("reset and settings pages fit a 375px screen", async ({ browser }) => {
  const page = await newPage(browser);
  await page.setViewportSize({ width: 375, height: 800 });
  await signUp(page, `a-really-long-address-for-wrapping-${randomUUID()}@example.test`);
  for (const path of ["/app/settings", "/forgot-password", "/reset-password?token=abcdefgh12345678", "/reset-password", "/email-verified"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(375);
  }
});
