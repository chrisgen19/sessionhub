// Run after building the extension: node infra/scripts/capture-store-screenshots.mjs
// Real UI, synthetic pages, temporary Chrome profile; never connects an account or enables sync.
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = new URL("../../", import.meta.url);
const require = createRequire(new URL("apps/extension/package.json", root));
const { chromium, expect } = require("@playwright/test");
const extension = fileURLToPath(new URL("apps/extension/.output/chrome-mv3", root));
const output = fileURLToPath(new URL("docs/store-assets", root));
const profile = await mkdtemp(path.join(tmpdir(), "sessionhub-store-"));
let context;
try {
  await mkdir(output, { recursive: true });
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1280, height: 800 }, colorScheme: "light",
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const site = "https://store-preview.example";
  await context.route(`${site}/**`, (route) => route.fulfill({
    contentType: "text/html", body: `<title>${new URL(route.request().url()).pathname.slice(1).replaceAll("-", " ")}</title><h1>Synthetic store preview</h1>`,
  }));
  for (const name of ["Project-notes", "Design-research", "API-reference"]) {
    const page = await context.newPage();
    await page.goto(`${site}/${name}`);
  }
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  await worker.evaluate(async (site) => {
    const tabs = await chrome.tabs.query({ url: `${site}/*` });
    await chrome.tabs.update(tabs[0].id, { pinned: true });
    const groupId = await chrome.tabs.group({ tabIds: tabs.slice(1).map((tab) => tab.id) });
    await chrome.tabGroups.update(groupId, { title: "Research", color: "green" });
  }, site);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${id}/manager.html`);
  const capture = await manager.evaluate(() => chrome.runtime.sendMessage({ type: "session.capture", scope: { kind: "all-windows" } }));
  if (!capture.ok) throw new Error("Preview save failed");
  const renamed = await manager.evaluate((sessionId) => chrome.runtime.sendMessage({ type: "session.rename", sessionId, expectedVersion: 1, name: "Project research" }), capture.data.sessionId);
  if (!renamed.ok) throw new Error("Preview rename failed");
  await manager.reload();
  await manager.getByRole("button", { name: /Project research/i }).click();
  const inspector = manager.getByRole("article", { name: /session details/i });
  await expect(inspector.getByRole("list", { name: "Group Research" })).toBeVisible();
  await manager.screenshot({ path: path.join(output, "manager.png") });
  // The ticked tree is the preview; the menu shows where the tabs can open.
  await inspector.getByRole("button", { name: "Choose where to open" }).click();
  await expect(manager.getByRole("menu", { name: "Choose where to open" })).toBeVisible();
  await manager.screenshot({ path: path.join(output, "restore-preview.png") });
  await manager.keyboard.press("Escape");
  await inspector.getByRole("button", { name: /^Open 3 tabs in / }).click();
  await expect(inspector.getByText(/opened 3 of 3 tabs/i)).toBeVisible();
  await manager.screenshot({ path: path.join(output, "restore-result.png") });
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
