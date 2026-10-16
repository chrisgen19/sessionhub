import { randomBytes, randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { waitForEmail } from "./mailpit";

/** Shared steps for driving the real extension's pairing against the E2E server. */

export const randomIp = () => {
  const [a, b, c] = randomBytes(3);
  return `10.${a}.${b}.${c}`;
};

/** Signs up in the extension's own profile, so the approve page sees the session cookie. */
export const signUp = async (context: BrowserContext, { confirm = true } = {}) => {
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

export const openAccountView = async (context: BrowserContext, extensionId: string) => {
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html#view=account`);
  await expect(manager.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  return manager;
};

/** Clicks Connect account and returns the approve tab the extension opened, plus the code it shows. */
export const startConnect = async (context: BrowserContext, manager: Page) => {
  const approveTab = context.waitForEvent("page");
  await manager.getByRole("button", { name: "Connect account" }).click();
  const code = (await manager.getByLabel("Connection code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  const tab = await approveTab;
  await tab.waitForLoadState();
  expect(tab.url()).toBe(`${BASE_URL}/app/pair?code=${code}`);
  return { tab, code };
};
