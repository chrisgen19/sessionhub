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
/**
 * Fired on window, with the choice as `detail`, when this page changes it (`storage` only reaches
 * other pages). The init script listens too, so it knows the choice even if storage didn't keep it.
 */
export const THEME_CHANGE_EVENT = "sessionhub-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Anything other than a known choice (nothing stored, an old or edited value) is the default. */
export const parseThemePreference = (value: unknown): ThemePreference =>
  THEME_PREFERENCES.find((preference) => preference === value) ?? DEFAULT_THEME_PREFERENCE;

export const resolveTheme = (preference: ThemePreference, systemDark: boolean): Theme =>
  preference === "dark" || (preference === "system" && systemDark) ? "dark" : "light";

/** This page's choice when storage refused it (blocked site data, a full quota). */
let unsaved: ThemePreference | null = null;

/** This page's unsaved choice, else the stored one, else the default (storage unavailable). */
export const readThemePreference = (): ThemePreference => {
  if (unsaved !== null) return unsaved;
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
};

export const applyThemePreference = (preference: ThemePreference): void => {
  document.documentElement.dataset.theme = resolveTheme(preference, matchMedia(DARK_QUERY).matches);
};

/**
 * Saves and applies the choice; other open pages of the same origin follow through `storage`. If
 * storage refuses it, the choice still holds for this page until it is closed.
 */
export const setThemePreference = (preference: ThemePreference): void => {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
    unsaved = null;
  } catch {
    unsaved = preference;
  }
  applyThemePreference(preference);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: preference }));
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
 * made in this page (THEME_CHANGE_EVENT) or another one (`storage`). It keeps the current choice
 * itself, so a choice storage refused still holds. ES5 and self-contained, since it runs before
 * any bundle.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)},m=matchMedia(${JSON.stringify(DARK_QUERY)}),c=null;function r(){try{c=localStorage.getItem(k)}catch(e){}}function a(){document.documentElement.setAttribute("data-theme",c==="dark"||(c==="system"&&m.matches)?"dark":"light")}r();a();m.addEventListener("change",a);addEventListener("storage",function(e){if(e.key===k||e.key===null){r();a()}});addEventListener(${JSON.stringify(THEME_CHANGE_EVENT)},function(e){c=e.detail;a()})}catch(e){}})();`;
