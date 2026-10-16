import { defineConfig } from "@playwright/test";
import { BASE_URL } from "./e2e-docker/stack";

/**
 * Container tests for infra/docker (pnpm test:docker). Builds the production images, runs
 * the compose stack under an isolated project name and tests it over HTTP and the Docker CLI.
 */
export default defineConfig({
  testDir: "./e2e-docker",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e-docker/global-setup.ts",
  globalTeardown: "./e2e-docker/global-teardown.ts",
  use: { baseURL: BASE_URL },
});
