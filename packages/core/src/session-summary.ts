import type { SavedSession } from "@sessionhub/contracts/session";

export interface SessionSummary {
  windowCount: number;
  tabCount: number;
  restorableTabCount: number;
}

export const summarizeSession = (session: SavedSession): SessionSummary => {
  const tabs = session.windows.flatMap((window) => window.tabs);
  return {
    windowCount: session.windows.length,
    tabCount: tabs.length,
    restorableTabCount: tabs.filter((tab) => tab.eligibility === "restorable").length,
  };
};

const inOrder = (session: SavedSession) =>
  [...session.windows].sort((a, b) => a.sortOrder - b.sortOrder).flatMap((window) => [...window.tabs].sort((a, b) => a.sortOrder - b.sortOrder));

/** The web site a tab is on (`www.` dropped), or null for anything but http(s) pages (browser pages, files). */
export const siteOf = (url: string): string | null => {
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === "https:" || protocol === "http:") && hostname ? hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

/** The sites with the most tabs, most first (ties by name), at most `limit`. */
export const topSites = (session: SavedSession, limit = 5): { site: string; count: number }[] => {
  const counts = new Map<string, number>();
  for (const tab of inOrder(session)) {
    const site = siteOf(tab.url);
    if (site) counts.set(site, (counts.get(site) ?? 0) + 1);
  }
  return [...counts]
    .map(([site, count]) => ({ site, count }))
    .sort((a, b) => b.count - a.count || a.site.localeCompare(b.site))
    .slice(0, limit);
};

/**
 * Tabs whose exact address already appears earlier in the session (window, then tab order): the extra
 * copies. With `among`, only those tabs count, so the first of them for each address is never a copy.
 */
export const duplicateTabIds = (session: SavedSession, among?: ReadonlySet<string>): Set<string> => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const tab of inOrder(session)) {
    if (tab.url.length === 0 || (among && !among.has(tab.id))) continue;
    if (seen.has(tab.url)) duplicates.add(tab.id);
    else seen.add(tab.url);
  }
  return duplicates;
};
