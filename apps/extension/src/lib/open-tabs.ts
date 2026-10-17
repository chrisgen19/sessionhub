import { tabMatchesQuery } from "@sessionhub/core/search";
import type { OpenWindow } from "./tab-selection";

/**
 * Rules for the manager's Open tabs view (docs/UI_UX_DESIGN.md 18m). Pure, like `tab-selection.ts`;
 * tab ids are Chrome's runtime ids.
 */

/**
 * Tabs open more than once at the same address. The first copy in list order (this window first,
 * then tab-strip order) is the original; every later copy is a duplicate. A tab without an address
 * yet (still loading) never counts.
 */
export const duplicateTabIds = (windows: OpenWindow[]): ReadonlySet<number> => {
  const seen = new Set<string>();
  const duplicates = new Set<number>();
  for (const tab of windows.flatMap((window) => window.tabs)) {
    if (!tab.url) continue;
    if (seen.has(tab.url)) duplicates.add(tab.id);
    else seen.add(tab.url);
  }
  return duplicates;
};

/** Tabs whose title or address has every search term; null without a search (nothing is filtered). */
export const matchingOpenTabIds = (windows: OpenWindow[], query: string): ReadonlySet<number> | null =>
  query.trim() ? new Set(windows.flatMap((window) => window.tabs.filter((tab) => tabMatchesQuery(tab, query)).map((tab) => tab.id))) : null;
