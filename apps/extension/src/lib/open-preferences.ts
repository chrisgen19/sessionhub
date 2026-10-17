import type { RestoreDestination } from "@sessionhub/core/restore-plan";

/**
 * The open picker's remembered choices, per browser in the extension's `localStorage` (shared by the
 * popup and the manager), like the theme (`@sessionhub/core/theme`). Storage can be unavailable, so
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
