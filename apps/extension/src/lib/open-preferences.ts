import type { RestoreDestination } from "@sessionhub/core/restore-plan";
import { SESSION_SORTS, type SessionSort } from "@sessionhub/core/session-organize";

/**
 * The open picker's remembered choices (and the manager list's sort), per browser in the extension's
 * `localStorage` (shared by the popup and the manager), like the theme (`@sessionhub/core/theme`). Storage can be unavailable, so
 * every read falls back to the default and every write is best effort.
 */
const TARGET_KEY = "sessionhub-open-target";
const SKIP_OPEN_KEY = "sessionhub-open-skip";

const DESTINATIONS: readonly RestoreDestination[] = ["new-windows", "one-window", "this-window"];

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered this time; the choice still applies to this open.
  }
};

/** The destination used last; new windows the first time. */
export const readOpenTarget = (): RestoreDestination => {
  const value = read(TARGET_KEY);
  return DESTINATIONS.find((destination) => destination === value) ?? "new-windows";
};

export const saveOpenTarget = (destination: RestoreDestination) => write(TARGET_KEY, destination);

/** "Skip tabs already open here" is on unless the user turned it off. */
export const readSkipOpen = (): boolean => read(SKIP_OPEN_KEY) !== "false";

export const saveSkipOpen = (skip: boolean) => write(SKIP_OPEN_KEY, String(skip));

const LAZY_KEY = "sessionhub-open-lazy";

/** "Keep tabs unloaded until clicked" is off unless the user turned it on. */
export const readOpenLazy = (): boolean => read(LAZY_KEY) === "true";

export const saveOpenLazy = (lazy: boolean) => write(LAZY_KEY, String(lazy));

const POPUP_TAB_KEY = "sessionhub-popup-tab";

export type PopupTab = "open" | "save";

/** The popup tab used last; Open the first time. */
export const readPopupTab = (): PopupTab => (read(POPUP_TAB_KEY) === "save" ? "save" : "open");

export const savePopupTab = (tab: PopupTab) => write(POPUP_TAB_KEY, tab);

const SORT_KEY = "sessionhub-session-sort";

/** The saved-session list's sort used last; recently changed first the first time. */
export const readSessionSort = (): SessionSort => {
  const value = read(SORT_KEY);
  return SESSION_SORTS.find((sort) => sort === value) ?? "updated";
};

export const saveSessionSort = (sort: SessionSort) => write(SORT_KEY, sort);
