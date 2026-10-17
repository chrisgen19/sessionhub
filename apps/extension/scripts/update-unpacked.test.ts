import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updateUnpacked } from "./update-unpacked";

let root: string;

/** A folder with the given files, as a WXT build or anything else. */
const folder = (name: string, files: Record<string, string>): string => {
  const dir = path.join(root, name);
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), contents);
  }
  return dir;
};
const manifest = (version: string) => JSON.stringify({ name: "SessionHub", version, host_permissions: ["https://sessions.example.com/*"] });

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "sessionhub-unpacked-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("updateUnpacked", () => {
  it("creates the folder, and its parents, on the first run", () => {
    const build = folder("build", { "manifest.json": manifest("0.1.1"), "chunks/popup.js": "new" });
    const target = path.join(root, "SessionHub", "extension");
    expect(updateUnpacked(build, target)).toEqual({ version: "0.1.1", hosts: ["https://sessions.example.com/*"] });
    expect(readFileSync(path.join(target, "chunks/popup.js"), "utf8")).toBe("new");
  });

  it("replaces the last build in the same folder, leaving none of its old files", () => {
    const target = folder("extension", { "manifest.json": manifest("0.1.0"), "chunks/popup-old.js": "old" });
    const build = folder("build", { "manifest.json": manifest("0.1.1"), "chunks/popup-new.js": "new" });
    updateUnpacked(build, target);
    expect(readdirSync(path.join(target, "chunks"))).toEqual(["popup-new.js"]);
    expect(JSON.parse(readFileSync(path.join(target, "manifest.json"), "utf8"))).toMatchObject({ version: "0.1.1" });
    expect(existsSync(`${target}.updating`)).toBe(false);
  });

  it("refuses a folder holding other files and leaves it untouched", () => {
    const target = folder("Documents", { "notes.txt": "keep me" });
    const build = folder("build", { "manifest.json": manifest("0.1.1") });
    expect(() => updateUnpacked(build, target)).toThrow(/holds other files/);
    expect(readdirSync(target)).toEqual(["notes.txt"]);
  });

  it("refuses a build that isn't SessionHub's and keeps the last build", () => {
    const target = folder("extension", { "manifest.json": manifest("0.1.0") });
    const build = folder("build", { "manifest.json": JSON.stringify({ name: "Other" }) });
    expect(() => updateUnpacked(build, target)).toThrow(/isn't a SessionHub build/);
    expect(JSON.parse(readFileSync(path.join(target, "manifest.json"), "utf8"))).toMatchObject({ version: "0.1.0" });
  });
});
