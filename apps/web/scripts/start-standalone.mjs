// Runs the production standalone server locally, exactly as the Docker image does
// (`next start` doesn't support `output: "standalone"`). Run `pnpm build` first.
// PORT, HOSTNAME and the app's env vars are read from the environment.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const appDir = path.resolve(import.meta.dirname, "..");
const standaloneApp = path.join(appDir, ".next/standalone/apps/web");
const server = path.join(standaloneApp, "server.js");

if (!existsSync(server)) throw new Error("No standalone build found. Run `pnpm build` first.");
// server.js serves .next/static only if it sits next to it (the Dockerfile copies it the same way).
cpSync(path.join(appDir, ".next/static"), path.join(standaloneApp, ".next/static"), { recursive: true });
await import(pathToFileURL(server).href);
