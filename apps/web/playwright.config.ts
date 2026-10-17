import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const databaseEnv = path.resolve(import.meta.dirname, "../../packages/database/.env");
if (existsSync(databaseEnv)) process.loadEnvFile(databaseEnv);

const PORT = 3917;
export const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Runs the production standalone build against TEST_DATABASE_URL. Needs `pnpm db:up`
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
    // The standalone server, as in the Docker image (see scripts/start-standalone.mjs).
    command: "node scripts/start-standalone.mjs",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      BETTER_AUTH_URL: BASE_URL,
      BETTER_AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-0123456789",
      // Real email delivery into Mailpit (pnpm db:up); tests read the messages back over its API.
      MAIL_TRANSPORT: "mailpit",
      MAIL_FROM: "SessionHub <no-reply@sessionhub.test>",
      MAILPIT_URL: process.env.TEST_MAILPIT_URL ?? "http://127.0.0.1:58025",
    },
  },
});
