import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";

const LIGHT_CANVAS = "rgb(247, 248, 245)";
const DARK_CANVAS = "rgb(17, 24, 21)";

/** Clicks an option's icon, as a user does (the radio itself is visually hidden), and checks it took. */
const choose = async (group: Locator, name: "Light" | "Dark" | "System") => {
  await group.getByTitle(name).click();
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

test("light by default on a dark system; a choice applies before the first paint in every extension page, and System follows the system", async ({
  context,
  extensionId,
}) => {
  const popup = await context.newPage();
  await popup.emulateMedia({ colorScheme: "dark" });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const popupTheme = popup.getByRole("group", { name: "Theme" });
  await expect(popupTheme.getByRole("radio", { name: "Light" })).toBeChecked();
  await expect(popup.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(popup.locator("body")).toHaveCSS("background-color", LIGHT_CANVAS);

  await choose(popupTheme, "Dark");
  await expect(popup.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(popup.locator("body")).toHaveCSS("background-color", DARK_CANVAS);

  // The manager shares the choice and is dark from its first paint.
  const manager = await context.newPage();
  await manager.addInitScript(recordFirstTheme);
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  expect(await manager.evaluate(() => (window as unknown as { firstTheme: unknown }).firstTheme)).toEqual({ theme: "dark", beforeBody: true });
  const managerTheme = manager.getByRole("group", { name: "Theme" });
  await expect(managerTheme.getByRole("radio", { name: "Dark" })).toBeChecked();

  // System follows the system live; the open popup follows the change made in the manager.
  await manager.emulateMedia({ colorScheme: "dark" });
  await choose(managerTheme, "System");
  await expect(manager.locator("html")).toHaveAttribute("data-theme", "dark");
  await manager.emulateMedia({ colorScheme: "light" });
  await expect(manager.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(popupTheme.getByRole("radio", { name: "System" })).toBeChecked();
  await expect(popup.locator("html")).toHaveAttribute("data-theme", "dark");
});
