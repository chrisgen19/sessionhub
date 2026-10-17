/**
 * Light, dark, or follow the system (docs/UI_UX_DESIGN.md 4.1). Light is the default. The choice
 * is kept per browser in localStorage (the web app's origin, or the extension's pages: the two are
 * separate) and applied as `data-theme="light" | "dark"` on <html>, before the first paint, by
 * THEME_INIT_SCRIPT. packages/ui/src/tokens.css switches the colors on that attribute.
 */
export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type Theme = "light" | "dark";

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "light";
export const THEME_STORAGE_KEY = "sessionhub-theme";
/** Fired on window when this page changes the choice (`storage` only reaches other pages). */
export const THEME_CHANGE_EVENT = "sessionhub-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Anything other than a known choice (nothing stored, an old or edited value) is the default. */
export const parseThemePreference = (value: unknown): ThemePreference =>
  THEME_PREFERENCES.find((preference) => preference === value) ?? DEFAULT_THEME_PREFERENCE;

export const resolveTheme = (preference: ThemePreference, systemDark: boolean): Theme =>
  preference === "dark" || (preference === "system" && systemDark) ? "dark" : "light";

/** The stored choice, or the default when storage is unavailable (blocked site data, say). */
export const readThemePreference = (): ThemePreference => {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
};

export const applyThemePreference = (preference: ThemePreference): void => {
  document.documentElement.dataset.theme = resolveTheme(preference, matchMedia(DARK_QUERY).matches);
};

/** Saves and applies the choice; other open pages of the same origin follow through `storage`. */
export const setThemePreference = (preference: ThemePreference): void => {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Not remembered, but still applied to this page.
  }
  applyThemePreference(preference);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
};

/** For useSyncExternalStore: changes made in this page or in another page of the same origin. */
export const subscribeToThemePreference = (onChange: () => void): (() => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
};

/**
 * A classic script that runs before the first paint: an inline <script> in the web app's <head>,
 * and theme-init.js in the extension's pages (generated from this string by wxt.config.ts). It
 * applies the stored choice, follows the system while "system" is chosen, and follows a choice
 * made in another page. ES5 and self-contained, since it runs before any bundle.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)},m=matchMedia(${JSON.stringify(DARK_QUERY)});function a(){var p=null;try{p=localStorage.getItem(k)}catch(e){}document.documentElement.setAttribute("data-theme",p==="dark"||(p==="system"&&m.matches)?"dark":"light")}a();m.addEventListener("change",a);addEventListener("storage",function(e){if(e.key===k||e.key===null)a()})}catch(e){}})();`;
