import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const databasePackage = path.resolve(import.meta.dirname, "../../../packages/database");

/**
 * Applies pending migrations to the test database with `prisma migrate deploy`, which
 * never drops data (no reset). Tests use unique emails, so no cleanup is needed.
 */
export default function setup(): void {
  const envFile = path.join(databasePackage, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL must be set to a database whose name ends in _test (see packages/database/.env.example)");
  }
  execFileSync(path.join(databasePackage, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: databasePackage,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  process.env.DATABASE_URL = url;
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.BETTER_AUTH_SECRET = "test-only-secret-not-used-anywhere-else-0123456789";
}
