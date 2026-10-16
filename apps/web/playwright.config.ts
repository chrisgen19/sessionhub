import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const databaseEnv = path.resolve(import.meta.dirname, "../../packages/database/.env");
if (existsSync(databaseEnv)) process.loadEnvFile(databaseEnv);

const PORT = 3917;
export const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Runs the production build (`next start`) against TEST_DATABASE_URL. Needs `pnpm db:up`
 * and `pnpm build`. Better Auth's URL must equal the browser origin for its origin check.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm exec next start --port ${PORT} --hostname 127.0.0.1`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      BETTER_AUTH_URL: BASE_URL,
      BETTER_AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-0123456789",
    },
  },
});
