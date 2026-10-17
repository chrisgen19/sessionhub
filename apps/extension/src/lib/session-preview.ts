import type { SavedSession, SavedTab } from "@sessionhub/contracts/session";
import { canOpen, tabsInOrder } from "./open-selection";

/**
 * Up to `max` tabs from different sites, in saved order, for a session's favicon preview in the
 * list. Only tabs that can reopen: the others have no favicon to show.
 */
export const previewTabs = (session: SavedSession, max = 4): SavedTab[] => {
  const hosts = new Set<string>();
  const picked: SavedTab[] = [];
  for (const window of session.windows) {
    for (const tab of tabsInOrder(window)) {
      if (!canOpen(tab)) continue;
      const host = new URL(tab.url).hostname.replace(/^www\./, "");
      if (hosts.has(host)) continue;
      hosts.add(host);
      picked.push(tab);
      if (picked.length === max) return picked;
    }
  }
  return picked;
};
