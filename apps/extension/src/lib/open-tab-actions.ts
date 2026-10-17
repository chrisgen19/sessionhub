import { browser } from "wxt/browser";

/** Selects a tab in its window and brings that window to the front. */
export const goToTab = async (tabId: number, windowId: number): Promise<void> => {
  await browser.tabs.update(tabId, { active: true });
  await browser.windows.update(windowId, { focused: true });
};

/**
 * Closes tabs one by one, so one that is already gone doesn't stop the rest. Returns how many
 * closed. Only called after the user chose to close them (docs/UI_UX_DESIGN.md 18m).
 */
export const closeTabs = async (tabIds: Iterable<number>): Promise<number> => {
  const results = await Promise.allSettled([...tabIds].map((id) => browser.tabs.remove(id)));
  return results.filter((result) => result.status === "fulfilled").length;
};
