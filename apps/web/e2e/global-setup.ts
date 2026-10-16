import setupTestDatabase from "../test/db-global-setup";
import { BASE_URL } from "../playwright.config";
import { buildExtensionForE2E } from "./extension";
import { MAILPIT_URL } from "./mailpit";

/**
 * Applies migrations to the test database (non-destructive `prisma migrate deploy`), checks
 * Mailpit is up and builds the extension for the pairing tests.
 */
export default async function globalSetup(): Promise<void> {
  setupTestDatabase();
  const ready = await fetch(new URL("/readyz", MAILPIT_URL)).then(
    (response) => response.ok,
    () => false,
  );
  if (!ready) throw new Error(`Mailpit isn't reachable at ${MAILPIT_URL}. Run \`pnpm db:up\` (it starts PostgreSQL and Mailpit).`);
  // The pairing tests drive the real extension against this server.
  buildExtensionForE2E(BASE_URL);
}
