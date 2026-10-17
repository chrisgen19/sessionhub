import { describe, expect, it } from "vitest";
import { parseThemePreference, resolveTheme, THEME_CHANGE_EVENT, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "./theme";

/** Runs the init script as a browser would before the first paint, against a minimal page. */
const runInitScript = ({ stored, systemDark = false, storageThrows = false }: { stored?: string; systemDark?: boolean; storageThrows?: boolean }) => {
  const values = new Map(stored === undefined ? [] : [[THEME_STORAGE_KEY, stored]]);
  const listeners = new Map<string, (event: { key?: string | null; detail?: string }) => void>();
  const query = { matches: systemDark, onChange: (() => undefined) as () => void, addEventListener: (_type: string, listener: () => void) => (query.onChange = listener) };
  const page = {
    theme: null as string | null,
    document: { documentElement: { setAttribute: (name: string, value: string) => name === "data-theme" && (page.theme = value) } },
    localStorage: {
      getItem: (key: string) => {
        if (storageThrows) throw new Error("SecurityError");
        return values.get(key) ?? null;
      },
    },
    matchMedia: () => query,
    addEventListener: (type: string, listener: (event: { key?: string | null; detail?: string }) => void) => listeners.set(type, listener),
  };
  // The script's globals are this function's parameters.
  new Function("document", "localStorage", "matchMedia", "addEventListener", THEME_INIT_SCRIPT)(page.document, page.localStorage, page.matchMedia, page.addEventListener);
  return {
    get theme() {
      return page.theme;
    },
    systemChanges: (dark: boolean) => {
      query.matches = dark;
      query.onChange();
    },
    /** The toggle in this page, which announces the choice whether or not storage kept it. */
    pageChooses: (value: string) => listeners.get(THEME_CHANGE_EVENT)?.({ detail: value }),
    otherPageStores: (value: string) => {
      values.set(THEME_STORAGE_KEY, value);
      listeners.get("storage")?.({ key: THEME_STORAGE_KEY });
    },
  };
};

describe("theme", () => {
  it("defaults to light, including for unknown stored values", () => {
    expect(parseThemePreference(null)).toBe("light");
    expect(parseThemePreference("sepia")).toBe("light");
    expect(parseThemePreference("system")).toBe("system");
  });

  it("resolves system from the browser and keeps explicit choices", () => {
    expect([resolveTheme("light", true), resolveTheme("dark", false), resolveTheme("system", true), resolveTheme("system", false)]).toEqual(["light", "dark", "dark", "light"]);
  });

  it("init script: light when nothing is stored, even on a dark system", () => {
    expect(runInitScript({ systemDark: true }).theme).toBe("light");
    expect(runInitScript({ stored: "sepia", systemDark: true }).theme).toBe("light");
  });

  it("init script: applies the stored choice, and light when storage is blocked", () => {
    expect(runInitScript({ stored: "dark" }).theme).toBe("dark");
    expect(runInitScript({ stored: "dark", storageThrows: true }).theme).toBe("light");
  });

  it("init script: follows the system live while system is chosen, and only then", () => {
    const system = runInitScript({ stored: "system", systemDark: true });
    expect(system.theme).toBe("dark");
    system.systemChanges(false);
    expect(system.theme).toBe("light");

    const light = runInitScript({ stored: "light" });
    light.systemChanges(true);
    expect(light.theme).toBe("light");
  });

  it("init script: keeps this page's choice when storage is blocked, and System still follows the system", () => {
    const page = runInitScript({ storageThrows: true });
    page.pageChooses("dark");
    page.systemChanges(false);
    expect(page.theme).toBe("dark");

    page.pageChooses("system");
    page.systemChanges(true);
    expect(page.theme).toBe("dark");
    page.systemChanges(false);
    expect(page.theme).toBe("light");
  });

  it("init script: follows a choice made in another page", () => {
    const page = runInitScript({});
    page.otherPageStores("dark");
    expect(page.theme).toBe("dark");
  });
});
