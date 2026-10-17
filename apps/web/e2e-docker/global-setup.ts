import { randomBytes } from "node:crypto";
import { BASE_URL, compose, WEB_PORT } from "./stack";

/**
 * Builds and starts PostgreSQL -> migrate -> web with throwaway secrets and waits until
 * every service is healthy (or the migrate job has completed). Removed again in teardown.
 */
export default function globalSetup(): void {
  process.env.POSTGRES_PASSWORD = randomBytes(16).toString("hex");
  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
  process.env.BETTER_AUTH_URL = BASE_URL;
  process.env.WEB_PORT = String(WEB_PORT);
  compose(["down", "-v", "--remove-orphans"]);
  compose(["up", "-d", "--build", "--wait", "--wait-timeout", "180"], { stdio: ["ignore", "ignore", "inherit"], timeout: 900_000 });
}
