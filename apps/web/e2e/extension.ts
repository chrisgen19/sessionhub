import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type BrowserContext, type Worker } from "@playwright/test";

/** The extension, built for E2E against this test server (see buildExtensionForE2E). */
export const EXTENSION_DIR = path.resolve(import.meta.dirname, "../../extension/.output/e2e/chrome-mv3");

/** Builds the real extension with WXT_API_BASE_URL = the E2E web server, into .output/e2e. */
export const buildExtensionForE2E = (baseUrl: string): void => {
  execFileSync("pnpm", ["--filter", "@sessionhub/extension", "exec", "wxt", "build"], {
    env: { ...process.env, WXT_API_BASE_URL: baseUrl, SESSIONHUB_EXT_OUT_DIR: ".output/e2e" },
    stdio: ["ignore", "ignore", "inherit"],
    timeout: 300_000,
  });
};

/** Chromium with the extension loaded and a throwaway profile; web pages share this profile. */
export const launchWithExtension = async (extraHTTPHeaders: Record<string, string>) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "sessionhub-pair-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    extraHTTPHeaders,
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  });
  const worker: Worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  const close = async (ctx: BrowserContext = context) => {
    await ctx.close();
    await rm(userDataDir, { recursive: true, force: true });
  };
  return { context, extensionId, close };
};
