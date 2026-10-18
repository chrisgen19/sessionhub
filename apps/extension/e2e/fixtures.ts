import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, test as base, type BrowserContext, type Worker } from "@playwright/test";

export const EXTENSION_PATH = path.resolve(import.meta.dirname, "../.output/chrome-mv3");
export const SITE = "https://sessionhub.test";

/**
 * Launches Chromium with the unpacked extension and a throwaway profile directory. `realWindows`
 * turns off Playwright's viewport emulation, which otherwise forces every window to one size, so
 * window bounds behave as in a real browser (an 800x600 screen headless).
 */
export const launchWithExtension = async (userDataDir: string, extraArgs: string[] = [], { realWindows = false } = {}): Promise<BrowserContext> => {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    ...(realWindows && { viewport: null }),
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`, ...extraArgs],
  });
  // Serve fake pages for SITE so tests need no network access.
  await context.route(`${SITE}/**`, (route) => {
    const name = new URL(route.request().url()).pathname.slice(1) || "home";
    return route.fulfill({ contentType: "text/html", body: `<title>Page ${name}</title><h1>${name}</h1>` });
  });
  return context;
};

export const getServiceWorker = async (context: BrowserContext): Promise<Worker> =>
  context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));

export const test = base.extend<{ userDataDir: string; context: BrowserContext; extensionId: string; worker: Worker }>({
  // eslint-disable-next-line no-empty-pattern
  userDataDir: async ({}, use) => {
    const dir = await mkdtemp(path.join(tmpdir(), "sessionhub-e2e-"));
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },
  context: async ({ userDataDir }, use) => {
    const context = await launchWithExtension(userDataDir);
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    await use(await getServiceWorker(context));
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;
