import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

/**
 * The SessionHub server this build talks to (docs/SYSTEM_DESIGN.md section 6). Set
 * WXT_API_BASE_URL per deployment; development builds default to the local web app.
 */
const apiOrigin = (): string => {
  const value = process.env.WXT_API_BASE_URL || "http://localhost:3000";
  const url = new URL(value);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error(`WXT_API_BASE_URL must use https (got ${url.origin})`);
  }
  return url.origin;
};

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: "src",
  // Lets E2E build a copy pointed at the test server without touching .output.
  outDir: process.env.SESSIONHUB_EXT_OUT_DIR ?? ".output",
  modules: ["@wxt-dev/module-react"],
  // Store upload name: sessionhub-<version>-chrome.zip (checked by scripts/check-release-zip.ts).
  zip: { name: "sessionhub" },
  // Explicit imports keep module boundaries readable and greppable.
  imports: false,
  manifest: () => ({
    name: "SessionHub",
    icons: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
    description: "Save, search and safely restore your browser windows. Local-first.",
    // Each permission maps to a shipped feature (docs/SECURITY_PRIVACY.md section 6):
    // tabs: read tab titles/URLs to save sessions; tabGroups: save/restore groups;
    // favicon: show cached favicons without fetching third-party icon URLs;
    // alarms: schedule debounced, bounded recovery checkpoints (MV3 workers can't keep timers).
    permissions: ["tabs", "tabGroups", "favicon", "alarms"],
    // Only the configured SessionHub server, for pairing and opt-in sync. No other sites.
    host_permissions: [`${apiOrigin()}/*`],
    // The _favicon endpoint used for icons needs Chrome 104+.
    minimum_chrome_version: "104",
  }),
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
