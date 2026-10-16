import { defineConfig } from "@playwright/test";

/** Loads the built extension (.output/chrome-mv3) into real Chromium. Run `pnpm build` first. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
});
