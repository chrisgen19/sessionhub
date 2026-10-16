import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  // Explicit imports keep module boundaries readable and greppable.
  imports: false,
  manifest: {
    name: "SessionHub",
    description: "Save, search and safely restore your browser windows. Local-first.",
    // Each permission maps to a shipped feature (docs/SECURITY_PRIVACY.md section 6):
    // tabs: read tab titles/URLs to save sessions; tabGroups: save/restore groups;
    // favicon: show cached favicons without fetching third-party icon URLs.
    permissions: ["tabs", "tabGroups", "favicon"],
    // The _favicon endpoint used for icons needs Chrome 104+.
    minimum_chrome_version: "104",
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
