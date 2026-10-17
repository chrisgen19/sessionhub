import { describe, expect, it } from "vitest";
import { checkRelease, PLACEHOLDER_ORIGIN, type ReleaseZip } from "./check-release-zip";

const ORIGIN = "https://sessions.example.com";

/** A ZIP as WXT builds it for ORIGIN, with overrides for one manifest key or file. */
const zipWith = ({ manifest = {}, files = {} }: { manifest?: Record<string, unknown>; files?: Record<string, string> } = {}): ReleaseZip => {
  const contents: Record<string, string> = {
    "background.js": `const API=new URL(\`${ORIGIN}\`).origin;/^(http|https):\\/\\/(localhost|127\\.0\\.0\\.1)/`,
    "popup.html": '<script type="module" src="/chunks/popup.js"></script>',
    "chunks/popup.js": "export {}",
    ...files,
  };
  const base = {
    manifest_version: 3,
    version: "0.1.0",
    permissions: ["tabs", "tabGroups", "favicon", "alarms"],
    host_permissions: [`${ORIGIN}/*`],
    background: { service_worker: "background.js" },
    icons: { "128": "icon-128.png" },
  };
  return { manifest: { ...base, ...manifest }, files: Object.keys(contents), read: (file) => contents[file] ?? "" };
};
const check = (zip: ReleaseZip, apiOrigin = ORIGIN) => checkRelease(zip, { apiOrigin, version: "0.1.0" });

describe("checkRelease", () => {
  it("passes a ZIP built for the configured https server", () => {
    expect(check(zipWith())).toEqual({ errors: [], warnings: [] });
  });

  it("refuses any permission or host beyond the documented set", () => {
    expect(check(zipWith({ manifest: { permissions: ["tabs", "tabGroups", "favicon", "alarms", "scripting"] } })).errors).toEqual([
      expect.stringContaining("permissions are [alarms, favicon, scripting, tabGroups, tabs]"),
    ]);
    expect(check(zipWith({ manifest: { host_permissions: [`${ORIGIN}/*`, "<all_urls>"] } })).errors).toEqual([expect.stringContaining("host_permissions must be exactly")]);
    expect(check(zipWith({ manifest: { content_scripts: [], externally_connectable: {} } })).errors).toEqual([
      expect.stringContaining("content_scripts"),
      expect.stringContaining("externally_connectable"),
    ]);
  });

  it("refuses a build for http or this machine, or one whose bundle kept the development server", () => {
    const local = zipWith({ manifest: { host_permissions: ["http://localhost:3000/*"] }, files: { "background.js": "new URL(`http://localhost:3000`)" } });
    const { errors } = check(local, "http://localhost:3000");
    expect(errors).toEqual([expect.stringContaining("must use https"), expect.stringContaining("development server localhost:3000 is in background.js")]);
    expect(check(zipWith({ files: { "background.js": "new URL(`https://other.example`)" } })).errors).toEqual([expect.stringContaining("WXT_API_BASE_URL wasn't applied")]);
  });

  it("refuses source maps, remote scripts and a version that doesn't match package.json", () => {
    const zip = zipWith({ manifest: { version: "0.2.0" }, files: { "background.js.map": "{}", "manager.html": '<script src="https://cdn.example/x.js"></script>' } });
    expect(check(zip).errors).toEqual([
      expect.stringContaining("manifest version 0.2.0"),
      expect.stringContaining("source maps"),
      expect.stringContaining("remotely hosted scripts"),
    ]);
  });

  it("warns, without failing, about missing icons and the placeholder server", () => {
    const zip = zipWith({ manifest: { icons: undefined, host_permissions: [`${PLACEHOLDER_ORIGIN}/*`] }, files: { "background.js": `new URL(\`${PLACEHOLDER_ORIGIN}\`)` } });
    expect(check(zip, PLACEHOLDER_ORIGIN)).toEqual({ errors: [], warnings: [expect.stringContaining("no icons"), expect.stringContaining("placeholder")] });
  });
});
