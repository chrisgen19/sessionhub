import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Release check for the Chrome Web Store ZIP (docs/DEPLOYMENT.md section 6), run by CI on every
 * change: `node scripts/check-release-zip.ts <dir with the ZIP> [<dir with a second build>]`.
 * Errors fail the build. Warnings are release blockers that don't stop CI yet.
 */

/** The permissions docs/SECURITY_PRIVACY.md section 6 justifies; anything else needs a review first. */
export const EXPECTED_PERMISSIONS = ["alarms", "favicon", "tabGroups", "tabs"];
/** Origin for builds without a configured server (RFC 2606 reserves `.invalid`: it never resolves). */
export const PLACEHOLDER_ORIGIN = "https://sessionhub.invalid";
/** The development default in src/lib/api-config.ts; a release bundle must not contain it. */
const DEV_FALLBACK = "localhost:3000";
/** Keys the security model assumes are absent (docs/SECURITY_PRIVACY.md 5a: no page can reach the extension). */
const FORBIDDEN_KEYS = ["content_scripts", "externally_connectable", "web_accessible_resources", "optional_permissions", "optional_host_permissions"];

export interface ReleaseZip {
  manifest: Record<string, unknown>;
  /** Paths inside the ZIP. */
  files: string[];
  read: (file: string) => string;
  readBytes: (file: string) => Uint8Array;
}

export interface ReleaseReport {
  errors: string[];
  warnings: string[];
}

const manifestProblems = (manifest: Record<string, unknown>, origin: URL, version: string): string[] => {
  const errors: string[] = [];
  if (manifest.manifest_version !== 3) errors.push(`manifest_version is ${String(manifest.manifest_version)}, expected 3`);
  const csp = manifest.content_security_policy as { extension_pages?: unknown } | undefined;
  if (csp?.extension_pages !== "script-src 'self'; object-src 'self'") errors.push("extension CSP must allow only packaged scripts and objects");
  if (manifest.version !== version) errors.push(`manifest version ${String(manifest.version)} doesn't match package.json ${version}`);
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions.map(String).sort() : [];
  if (permissions.join() !== EXPECTED_PERMISSIONS.join()) {
    errors.push(`permissions are [${permissions.join(", ")}], expected exactly [${EXPECTED_PERMISSIONS.join(", ")}] (SECURITY_PRIVACY.md section 6)`);
  }
  if (origin.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) {
    errors.push(`the API origin ${origin.origin} must use https and not point at this machine`);
  }
  const hosts = JSON.stringify(manifest.host_permissions ?? null);
  if (hosts !== JSON.stringify([`${origin.origin}/*`])) errors.push(`host_permissions must be exactly ["${origin.origin}/*"], got ${hosts}`);
  for (const key of FORBIDDEN_KEYS) if (key in manifest) errors.push(`the manifest has ${key}; the security model assumes it doesn't`);
  return errors;
};

const bundleProblems = (zip: ReleaseZip, origin: URL): string[] => {
  const errors: string[] = [];
  const maps = zip.files.filter((file) => file.endsWith(".map"));
  if (maps.length > 0) errors.push(`source maps in the ZIP: ${maps.join(", ")}`);
  const worker = (zip.manifest.background as { service_worker?: unknown } | undefined)?.service_worker;
  if (typeof worker !== "string" || !zip.files.includes(worker)) errors.push("the ZIP has no background service worker");
  else if (!zip.read(worker).includes(origin.origin)) errors.push(`the service worker doesn't contain ${origin.origin}: WXT_API_BASE_URL wasn't applied`);
  const fallback = zip.files.filter((file) => file.endsWith(".js") && zip.read(file).includes(DEV_FALLBACK));
  if (fallback.length > 0) errors.push(`the development server ${DEV_FALLBACK} is in ${fallback.join(", ")}`);
  const remote = zip.files.filter((file) => file.endsWith(".html") && /<script[^>]+src=["']?(https?:)?\/\//i.test(zip.read(file)));
  if (remote.length > 0) errors.push(`remotely hosted scripts (not allowed in MV3) in ${remote.join(", ")}`);
  return errors;
};

/** Everything that would make this ZIP wrong to publish, given the server it was built for. */
export const checkRelease = (zip: ReleaseZip, { apiOrigin, version }: { apiOrigin: string; version: string }): ReleaseReport => {
  const origin = new URL(apiOrigin);
  const warnings: string[] = [];
  const iconErrors: string[] = [];
  const icons = zip.manifest.icons as Record<string, unknown> | undefined;
  for (const size of [16, 32, 48, 128]) {
    const file = icons?.[String(size)];
    if (typeof file !== "string" || !zip.files.includes(file)) {
      iconErrors.push(`missing packaged ${size}x${size} icon`);
      continue;
    }
    const bytes = zip.readBytes(file);
    const png = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 24 || !png.every((byte, index) => bytes[index] === byte) || view.getUint32(16) !== size || view.getUint32(20) !== size) {
      iconErrors.push(`${file} must be a ${size}x${size} PNG`);
    }
  }
  if (origin.origin === PLACEHOLDER_ORIGIN) {
    warnings.push(`built for the placeholder ${PLACEHOLDER_ORIGIN}; set the repository variable EXTENSION_API_BASE_URL for a real release`);
  }
  return { errors: [...iconErrors, ...manifestProblems(zip.manifest, origin, version), ...bundleProblems(zip, origin)], warnings };
};

const findZip = (dir: string): string => {
  const zips = readdirSync(dir).filter((file) => file.endsWith("-chrome.zip"));
  if (zips.length !== 1) throw new Error(`expected exactly one *-chrome.zip in ${dir}, found ${zips.length}`);
  return path.join(dir, zips[0] ?? "");
};

const sha256 = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Reads a ZIP with the system `unzip` (present on CI runners and macOS); no extra dependency. */
const openZip = (file: string): ReleaseZip => {
  const read = (name: string) => execFileSync("unzip", ["-p", file, name], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const files = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" }).split("\n").filter(Boolean);
  const readBytes = (name: string) => execFileSync("unzip", ["-p", file, name], { maxBuffer: 64 * 1024 * 1024 });
  return { manifest: JSON.parse(read("manifest.json")) as Record<string, unknown>, files, read, readBytes };
};

const main = (): void => {
  const [dir, secondDir] = process.argv.slice(2);
  const apiOrigin = process.env.WXT_API_BASE_URL;
  if (!dir || !apiOrigin) throw new Error("usage: WXT_API_BASE_URL=<origin> node scripts/check-release-zip.ts <zip dir> [<second build's zip dir>]");
  const zip = findZip(dir);
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  const report = checkRelease(openZip(zip), { apiOrigin, version });
  const reproduced = secondDir ? sha256(findZip(secondDir)) === sha256(zip) : null;
  if (reproduced === false) report.errors.push("a second build of the same commit differs: the ZIP isn't reproducible");
  const annotate = process.env.GITHUB_ACTIONS === "true";
  const lines = [
    `${path.basename(zip)} sha256 ${sha256(zip)}${reproduced ? " (a second build is identical)" : ""}`,
    ...report.warnings.map((text) => `${annotate ? "::warning::" : "warning: "}${text}`),
    ...report.errors.map((text) => `${annotate ? "::error::" : "error: "}${text}`),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  if (report.errors.length > 0) process.exitCode = 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
