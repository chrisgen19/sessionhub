import type { Page } from "@playwright/test";
import type { browser } from "wxt/browser";
import { expect, SITE, test } from "./fixtures";

// The extension's `chrome` global inside evaluate().
declare const chrome: typeof browser;

/** At >=1280 px only the manager's panes scroll: how far the page itself scrolls (0), and whether `pane` scrolls. */
const measure = (page: Page, pane: string) =>
  page.evaluate((selector) => {
    const element = document.querySelector(selector)!;
    return {
      pageOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      paneScrolls: element.scrollHeight > element.clientHeight,
    };
  }, pane);

test("at 1280 px and wider the manager's panes scroll, never the page: no blank space below them", async ({ context, worker, extensionId }) => {
  // A long window ending in browser pages: their rows' sr-only reasons once escaped the panes and
  // stretched the page by about a screen of blank space (Open tabs and the Saved sessions inspector).
  await worker.evaluate(async (site) => {
    const window = await chrome.windows.create({ url: Array.from({ length: 30 }, (_, index) => `${site}/page-${index}`), focused: false });
    for (const url of ["chrome://version/", "chrome://settings/"]) await chrome.tabs.create({ windowId: window!.id, url, active: false });
  }, SITE);
  const manager = await context.newPage();
  await manager.setViewportSize({ width: 1440, height: 800 });

  await manager.goto(`chrome-extension://${extensionId}/manager.html#view=open-tabs`);
  // At least the two browser pages (the first window's about:blank is one too).
  await expect(manager.getByText("Won't reopen").nth(1)).toBeAttached();
  expect(await measure(manager, 'main[aria-label="Open tabs"] > div')).toEqual({ pageOverflow: 0, paneScrolls: true });

  const saved = await manager.evaluate(() => chrome.runtime.sendMessage({ type: "session.capture", scope: { kind: "all-windows" }, name: "Long window" }));
  await manager.goto(`chrome-extension://${extensionId}/manager.html#session=${(saved as { data: { sessionId: string } }).data.sessionId}`);
  await expect(manager.getByRole("article", { name: /session details/i }).getByText("Won't open").nth(1)).toBeAttached();
  expect(await measure(manager, 'section[aria-label="Inspector"]')).toEqual({ pageOverflow: 0, paneScrolls: true });
});
