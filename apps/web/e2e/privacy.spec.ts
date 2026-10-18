import { expect, test } from "@playwright/test";

test("privacy policy is public, linked from home, and describes the shipped limitations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Privacy policy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy policy", exact: true })).toBeVisible();
  await expect(page.getByText("Site exclusions and query-parameter stripping are", { exact: false })).toBeVisible();
  await expect(page.getByText("including its Limited Use requirements.", { exact: false })).toBeVisible();
  await expect(page.getByText("there is no self-service account deletion", { exact: false })).toBeVisible();
  await expect(page.getByText("pinned state, window size, position and state, timestamps", { exact: false })).toBeVisible();
});
