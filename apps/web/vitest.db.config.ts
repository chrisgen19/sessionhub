import path from "node:path";
import { defineConfig } from "vitest/config";

/** Integration tests against TEST_DATABASE_URL (run `pnpm db:up` first). */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    globalSetup: ["./test/db-global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
