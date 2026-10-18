import { browser, type Browser } from "wxt/browser";
import type { CaptureWindowInput } from "@sessionhub/core/capture";
import { BrowserError, type HandlerDeps } from "./command-handlers";
import { selectTabs } from "./tab-selection";
import { savedPlacement } from "./window-placement";

const TAB_GROUP_ID_NONE = -1;

const isOwnPage = (url: string) => url.startsWith(browser.runtime.getURL("/"));

const toCaptureWindow = async (window: Browser.windows.Window): Promise<CaptureWindowInput> => {
  const groups = window.id === undefined ? [] : await browser.tabGroups.query({ windowId: window.id });
  return {
    groups: groups.map((group) => ({
      key: group.id,
      title: group.title ?? "",
      color: group.color,
      collapsed: group.collapsed,
    })),
    // SessionHub's own pages (manager, popup opened as a tab) are never captured.
    tabs: (window.tabs ?? []).filter((tab) => !isOwnPage(tab.url || tab.pendingUrl || "")).map((tab) => ({
      url: tab.url || tab.pendingUrl || "",
      title: tab.title ?? "",
      pinned: tab.pinned,
      index: tab.index,
      groupKey: tab.groupId === TAB_GROUP_ID_NONE ? null : tab.groupId,
    })),
    // How it was shown, for reopening it the same way (disclosed on the privacy page).
    ...savedPlacement(window),
  };
};

/**
 * Reads normal, non-incognito windows. Private windows are excluded by design
 * (docs/SECURITY_PRIVACY.md section 2).
 */
export const readBrowserWindows: HandlerDeps["readWindows"] = async (scope) => {
  if (scope.kind === "window") {
    const window = await browser.windows.get(scope.windowId, { populate: true }).catch(() => {
      throw new BrowserError("That window is no longer open");
    });
    if (window.incognito) throw new BrowserError("Private windows aren't saved");
    if (window.type !== "normal") throw new BrowserError("Only normal browser windows can be saved");
    return [await toCaptureWindow(window)];
  }
  const windows = (await browser.windows.getAll({ populate: true, windowTypes: ["normal"] })).filter((window) => !window.incognito);
  // Only what the user ticked, read from Chrome now: a tab moved meanwhile is saved where it is.
  return Promise.all((scope.kind === "tabs" ? selectTabs(windows, scope.tabIds) : windows).map(toCaptureWindow));
};
