import type { SavedSession, SavedTab, SavedWindow } from "@sessionhub/contracts/session";
import { tabMatchesQuery } from "@sessionhub/core/search";
import { classifyUrl } from "@sessionhub/core/url-classification";
import type { WindowState } from "./tab-selection";

/**
 * Which saved tabs the user ticked in the open picker (docs/UI_UX_DESIGN.md section 12 update).
 * Only tabs that can reopen can be ticked: restorability is re-checked from the URL, as the
 * planner does, rather than trusting the stored field. Ids are saved tab ids.
 */
export type SavedSelection = ReadonlySet<string>;

export const canOpen = (tab: SavedTab): boolean => classifyUrl(tab.url).eligibility === "restorable";

/** A window's tabs in saved order. */
export const tabsInOrder = (window: SavedWindow): SavedTab[] => [...window.tabs].sort((a, b) => a.sortOrder - b.sortOrder);

const openableIds = (windows: SavedWindow[]) => windows.flatMap((window) => window.tabs.filter(canOpen).map((tab) => tab.id));

/** When the picker opens: every tab that can reopen. */
export const allOpenable = (session: SavedSession): SavedSelection => new Set(openableIds(session.windows));

export const savedWindowState = (window: SavedWindow, selection: SavedSelection): WindowState => {
  const ids = openableIds([window]);
  if (ids.length > 0 && ids.every((id) => selection.has(id))) return "checked";
  return ids.some((id) => selection.has(id)) ? "mixed" : "unchecked";
};

/** A window box click: unticks the window when it is checked, otherwise ticks every tab in it that can reopen. */
export const toggleSavedWindow = (selection: SavedSelection, window: SavedWindow): SavedSelection => {
  const next = new Set(selection);
  const checked = savedWindowState(window, selection) === "checked";
  for (const id of openableIds([window])) {
    if (checked) next.delete(id);
    else next.add(id);
  }
  return next;
};

/** Tabs that can reopen whose title or URL matches the search. */
export const matchingTabIds = (session: SavedSession, query: string): SavedSelection =>
  new Set(session.windows.flatMap((window) => window.tabs.filter((tab) => canOpen(tab) && tabMatchesQuery(tab, query)).map((tab) => tab.id)));

/** After the session changed (a rename keeps the ids, a sync download may not): drops ids no longer in it. */
export const reconcileSaved = (selection: SavedSelection, session: SavedSession): SavedSelection => {
  const ids = allOpenable(session);
  const kept = [...selection].filter((id) => ids.has(id));
  return kept.length === selection.size ? selection : new Set(kept);
};

/** True when every tab that can reopen is ticked, so the command can leave `tabIds` out. */
export const isEverything = (selection: SavedSelection, session: SavedSession): boolean => {
  const ids = allOpenable(session);
  return ids.size === selection.size && [...ids].every((id) => selection.has(id));
};
