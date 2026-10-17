import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

/**
 * Resets TEST_DATABASE_URL and applies every migration from scratch, so the tests
 * exercise the real migration SQL. Refuses to run against a database whose name
 * doesn't end in "_test".
 */
export default function setup(): void {
  const envFile = path.join(root, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Run `pnpm db:up` and copy packages/database/.env.example to .env.");
  }
  if (!new URL(url).pathname.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL must point at a database whose name ends in _test");
  }
  execFileSync(path.join(root, "node_modules/.bin/prisma"), ["migrate", "reset", "--force"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
