import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import path from "node:path";

/** Isolated compose project for the container tests (own network, volume and secrets). */
export const PROJECT = "sessionhub-smoke";
export const WEB_PORT = 3939;
export const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
export const COMPOSE_FILE = path.resolve(import.meta.dirname, "../../../infra/docker/compose.yaml");

export const compose = (args: string[], options: ExecFileSyncOptions = {}): string =>
  execFileSync("docker", ["compose", "-p", PROJECT, "-f", COMPOSE_FILE, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }) as string;
