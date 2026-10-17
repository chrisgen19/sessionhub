import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Puts a build in the one folder Chrome loads SessionHub from unpacked, replacing the last one:
 * `node scripts/update-unpacked.ts <build dir>` (run by `build:unpacked`). Chrome derives an
 * unpacked extension's ID from its folder path, so keeping the folder keeps the ID and the saved
 * sessions. The folder is ~/SessionHub/extension, or SESSIONHUB_UNPACKED_DIR.
 */
export const DEFAULT_UNPACKED_DIR = path.join(os.homedir(), "SessionHub", "extension");

const readManifest = (dir: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/**
 * Replaces `target` with a copy of `build`. The copy goes to a sibling folder and is swapped in
 * only when complete, so a failed copy leaves the last build loadable. A non-empty `target` that
 * isn't a SessionHub build is refused, so a wrong path can't wipe other files.
 */
export const updateUnpacked = (build: string, target: string): { version: string; hosts: string[] } => {
  const manifest = readManifest(build);
  if (manifest?.name !== "SessionHub") throw new Error(`${build} isn't a SessionHub build (no manifest.json named SessionHub)`);
  if (existsSync(target) && readdirSync(target).length > 0 && readManifest(target)?.name !== "SessionHub") {
    throw new Error(`${target} holds other files, not a SessionHub build; refusing to replace it (set SESSIONHUB_UNPACKED_DIR to another folder)`);
  }
  const staging = `${target}.updating`;
  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  cpSync(build, staging, { recursive: true });
  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
  return { version: String(manifest.version), hosts: Array.isArray(manifest.host_permissions) ? manifest.host_permissions.map(String) : [] };
};

const main = (): void => {
  const [build] = process.argv.slice(2);
  if (!build) throw new Error("usage: node scripts/update-unpacked.ts <build dir>");
  const target = path.resolve(process.env.SESSIONHUB_UNPACKED_DIR || DEFAULT_UNPACKED_DIR);
  const { version, hosts } = updateUnpacked(build, target);
  process.stdout.write(
    [
      `SessionHub ${version} (${hosts.join(", ")}) is in ${target}`,
      "First time: Load unpacked on chrome://extensions and pick that folder. After an update: click the extension's reload button.",
    ].join("\n") + "\n",
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
