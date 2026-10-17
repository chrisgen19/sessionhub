import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer loads .env itself; use Node's built-in loader (no dotenv dependency).
const envFile = path.resolve(import.meta.dirname, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Only migrate/introspect commands need it; `prisma generate` works without a database.
  datasource: { url: process.env.DATABASE_URL },
});
