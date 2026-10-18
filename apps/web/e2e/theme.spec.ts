import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomIp, signUp } from "./pairing-flow";

const LIGHT_CANVAS = "rgb(247, 248, 245)";
const DARK_CANVAS = "rgb(17, 24, 21)";

/**
 * Picks an option by clicking its icon, as a user does (the radio is visually hidden). Retried
 * until the page applies it: a click before hydration only ticks the native radio.
 */
const choose = async (page: Page, group: Locator, name: "Light" | "Dark" | "System", theme: "light" | "dark") => {
  await expect(async () => {
    await group.getByTitle(name === "Light" ? "Dark" : "Light").click();
    await group.getByTitle(name).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme, { timeout: 1_000 });
  }).toPass();
  await expect(group.getByRole("radio", { name })).toBeChecked();
};

/** Records the theme when first applied, and whether <body> existed yet (it mustn't: no flash). */
const recordFirstTheme = () => {
  const record: { theme: string | null; beforeBody: boolean | null } = { theme: null, beforeBody: null };
  Object.assign(window, { firstTheme: record });
  // <html> doesn't exist yet when init scripts run: watch the whole document.
  new MutationObserver((_, observer) => {
    record.theme = document.documentElement.getAttribute("data-theme");
    record.beforeBody = document.body === null;
    observer.disconnect();
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-theme"] });
};

test("light by default on a dark system; the choice applies before the first paint on every page, and System follows the system", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const theme = page.getByRole("group", { name: "Theme" });
  await expect(theme.getByRole("radio", { name: "Light" })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", LIGHT_CANVAS);

  await choose(page, theme, "Dark", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", DARK_CANVAS);

  // Remembered, and applied by the inline script before the body is parsed: no light flash.
  await page.addInitScript(recordFirstTheme);
  await page.reload();
  expect(await page.evaluate(() => (window as unknown as { firstTheme: unknown }).firstTheme)).toEqual({ theme: "dark", beforeBody: true });
  await expect(theme.getByRole("radio", { name: "Dark" })).toBeChecked();

  for (const path of ["/login", "/privacy"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(theme.getByRole("radio", { name: "Dark" })).toBeChecked();
  }

  // System follows the system, live.
  await choose(page, theme, "System", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("the dashboard has the toggle: in the sidebar, and in the top bar on a phone", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
  const { page } = await signUp(context, { confirm: false });
  const sidebar = page.getByRole("complementary").getByRole("group", { name: "Theme" });
  await expect(sidebar.getByRole("radio", { name: "Light" })).toBeChecked();
  await choose(page, sidebar, "Dark", "dark");

  // A phone has no sidebar; its top bar's toggle shows the same choice and changes it.
  await page.setViewportSize({ width: 390, height: 844 });
  const topBar = page.getByRole("banner").getByRole("group", { name: "Theme" });
  await expect(topBar.getByRole("radio", { name: "Dark" })).toBeChecked();
  await choose(page, topBar, "Light", "light");
  await context.close();
});
