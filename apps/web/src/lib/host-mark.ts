import type { TabGroupColor } from "@sessionhub/contracts/session";
import { classifyUrl } from "@sessionhub/core/url-classification";

/**
 * A site's mark in tab lists: its first letter on a color picked from the tab-group palette by the
 * host name, so every tab of a site looks the same. The website can't read Chrome's favicon cache,
 * and fetching icons from a third party would tell it which sites the user saved.
 */
export interface HostMark {
  letter: string;
  color: TabGroupColor;
}

/** Colors white text stays legible on; grey and yellow are left out. */
const MARK_COLORS: readonly TabGroupColor[] = ["blue", "red", "green", "pink", "purple", "cyan", "orange"];

/** Null for anything that isn't a web page (browser pages, files): those keep a generic icon. */
export const hostMark = (url: string): HostMark | null => {
  if (classifyUrl(url).eligibility !== "restorable") return null;
  const host = new URL(url).hostname.replace(/^www\./, "");
  const letter = host.match(/[a-z0-9]/i)?.[0]?.toUpperCase();
  if (!letter) return null;
  let hash = 0;
  for (const char of host) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { letter, color: MARK_COLORS[hash % MARK_COLORS.length] ?? "blue" };
};
