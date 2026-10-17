import type { Worker } from "@playwright/test";
import type { browser } from "wxt/browser";
import { expect, SITE, test } from "./fixtures";

// The extension's `chrome` global inside worker.evaluate().
declare const chrome: typeof browser;

const urlsIn = (worker: Worker, windowId: number) =>
  worker.evaluate(async (id) => (await chrome.tabs.query({ windowId: id })).map((tab) => tab.url ?? tab.pendingUrl ?? ""), windowId);

test("open tabs: duplicates are marked, closing asks first and closes only the ticked tabs, a title goes to its tab", async ({ context, worker, extensionId }) => {
  const windowId = await worker.evaluate(async (site) => {
    const window = await chrome.windows.create({ url: [`${site}/one`, `${site}/two`, `${site}/one`, `${site}/three`], focused: false });
    return window!.id!;
  }, SITE);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html#view=open-tabs`);
  // Tabs opened through chrome.windows.create bypass the test's route, so match them by address.
  const region = manager.getByRole("region").filter({ hasText: "sessionhub.test/three" });
  const row = (address: string) => region.getByRole("listitem").filter({ hasText: address });
  await expect(region.getByText("Duplicate")).toHaveCount(1);

  // Select duplicates ticks the second copy only; nothing closes until confirmed.
  await manager.getByRole("button", { name: "Select duplicates (1)" }).click();
  await expect(manager.getByText("1 tab in 1 window selected")).toBeVisible();
  await manager.getByRole("button", { name: "Close 1 tab…" }).click();
  await expect(manager.getByRole("alertdialog", { name: "Confirm closing" })).toBeVisible();
  expect(await urlsIn(worker, windowId)).toHaveLength(4);
  await manager.getByRole("alertdialog").getByRole("button", { name: "Close 1 tab" }).click();
  await expect(manager.getByText("Closed 1 tab.")).toBeVisible();
  await expect.poll(() => urlsIn(worker, windowId)).toEqual([`${SITE}/one`, `${SITE}/two`, `${SITE}/three`]);
  await expect(region.getByText("Duplicate")).toHaveCount(0);

  // A title selects that tab in its window (the first button in the row; the ✕ comes after it).
  await row("sessionhub.test/two").getByRole("button").first().click();
  await expect
    .poll(() => worker.evaluate(async (id) => (await chrome.tabs.query({ windowId: id, active: true }))[0]?.url, windowId))
    .toBe(`${SITE}/two`);

  // The ✕ closes one tab at once, ticked or not.
  await row("sessionhub.test/three").getByRole("button", { name: /^Close tab/ }).click();
  await expect.poll(() => urlsIn(worker, windowId)).toEqual([`${SITE}/one`, `${SITE}/two`]);
});
