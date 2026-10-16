import setupTestDatabase from "../test/db-global-setup";

/** Applies migrations to the test database (non-destructive `prisma migrate deploy`). */
export default function globalSetup(): void {
  setupTestDatabase();
}
