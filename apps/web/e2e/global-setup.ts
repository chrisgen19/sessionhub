import setupTestDatabase from "../test/db-global-setup";
import { MAILPIT_URL } from "./mailpit";

/** Applies migrations to the test database (non-destructive `prisma migrate deploy`) and checks Mailpit is up. */
export default async function globalSetup(): Promise<void> {
  setupTestDatabase();
  const ready = await fetch(new URL("/readyz", MAILPIT_URL)).then(
    (response) => response.ok,
    () => false,
  );
  if (!ready) throw new Error(`Mailpit isn't reachable at ${MAILPIT_URL}. Run \`pnpm db:up\` (it starts PostgreSQL and Mailpit).`);
}
