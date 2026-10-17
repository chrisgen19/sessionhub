import type { WindowInput } from "@sessionhub/contracts/api-sessions";
import type { SavedGroup, SavedTab, SavedWindow } from "@sessionhub/contracts/session";
import { classifyUrl } from "./url-classification";

export interface CanonicalStructure {
  windows: SavedWindow[];
  windowCount: number;
  tabCount: number;
}

/**
 * Converts untrusted API window input into the canonical stored structure: fresh ids for
 * every window, group and tab (group references remapped), order taken from array
 * position, and every URL re-classified (client-supplied eligibility is never trusted).
 */
export const buildCanonicalStructure = (input: readonly WindowInput[], createId: () => string): CanonicalStructure => {
  const windows = input.map((window, windowOrder): SavedWindow => {
    const groupIds = new Map<string, string>();
    const groups = window.groups.map((group, sortOrder): SavedGroup => {
      const id = createId();
      groupIds.set(group.id, id);
      return { id, title: group.title, color: group.color, collapsed: group.collapsed, sortOrder };
    });
    const tabs = window.tabs.map(
      (tab, sortOrder): SavedTab => ({
        id: createId(),
        title: tab.title,
        url: tab.url,
        pinned: tab.pinned,
        sortOrder,
        groupId: tab.groupId === null ? null : (groupIds.get(tab.groupId) ?? null),
        eligibility: classifyUrl(tab.url).eligibility,
      }),
    );
    return { id: createId(), sortOrder: windowOrder, groups, tabs };
  });
  return { windows, windowCount: windows.length, tabCount: windows.reduce((sum, window) => sum + window.tabs.length, 0) };
};
