import { classifyUrl } from "@sessionhub/core/url-classification";
import { useEffect, useState } from "react";
import { browser, type Browser } from "wxt/browser";
import type { OpenTab, OpenWindow } from "../lib/tab-selection";

const TAB_GROUP_ID_NONE = -1;
/** Bursts of tab events (a restore, a window closing) become one refresh. */
const REFRESH_DELAY_MS = 150;

export type OpenWindowsState =
  | { status: "loading" }
  | { status: "ready"; windows: OpenWindow[]; currentWindowId: number | null }
  | { status: "error"; message: string };

const isOwnPage = (url: string) => url.startsWith(browser.runtime.getURL("/"));

const toOpenTab = (tab: Browser.tabs.Tab): OpenTab | null => {
  const url = tab.url || tab.pendingUrl || "";
  // SessionHub's own pages are never listed or saved (same rule as the worker's capture).
  if (tab.id === undefined || isOwnPage(url)) return null;
  return {
    id: tab.id,
    title: tab.title ?? "",
    url,
    pinned: tab.pinned,
    groupId: tab.groupId === TAB_GROUP_ID_NONE ? null : tab.groupId,
    eligibility: classifyUrl(url).eligibility,
  };
};

/**
 * Normal, non-incognito windows with their tabs in tab-strip order, the current window first.
 * Windows left without tabs (for example one holding only the manager) aren't listed.
 */
const readOpenWindows = async (): Promise<{ windows: OpenWindow[]; currentWindowId: number | null }> => {
  const [all, current] = await Promise.all([
    browser.windows.getAll({ populate: true, windowTypes: ["normal"] }),
    browser.windows.getCurrent().catch(() => undefined),
  ]);
  const currentWindowId = current?.id ?? null;
  const windows = await Promise.all(
    all
      .filter((window) => !window.incognito && window.id !== undefined)
      .map(async (window): Promise<OpenWindow> => {
        const groups = await browser.tabGroups.query({ windowId: window.id });
        const tabs = [...(window.tabs ?? [])].sort((a, b) => a.index - b.index).map(toOpenTab).filter((tab) => tab !== null);
        return { id: window.id ?? 0, tabs, groups: groups.map((group) => ({ id: group.id, title: group.title ?? "", color: group.color })) };
      }),
  );
  windows.sort((a, b) => Number(b.id === currentWindowId) - Number(a.id === currentWindowId));
  return { windows: windows.filter((window) => window.tabs.length > 0), currentWindowId };
};

/** Live view of the open windows for the save picker; refreshes when tabs open, close, move or change. */
export function useOpenWindows(): OpenWindowsState {
  const [state, setState] = useState<OpenWindowsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      void readOpenWindows().then(
        (next) => !cancelled && setState({ status: "ready", ...next }),
        (error: unknown) => !cancelled && setState({ status: "error", message: error instanceof Error ? error.message : "Couldn't read your open tabs" }),
      );
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(load, REFRESH_DELAY_MS);
    };
    const onUpdated = (_tabId: number, change: Browser.tabs.OnUpdatedInfo) => {
      // Loading and favicon updates don't change what the picker shows.
      if (change.url !== undefined || change.title !== undefined || change.pinned !== undefined || change.groupId !== undefined) refresh();
    };
    const events = [
      browser.tabs.onCreated,
      browser.tabs.onRemoved,
      browser.tabs.onMoved,
      browser.tabs.onAttached,
      browser.tabs.onDetached,
      browser.tabs.onReplaced,
      browser.windows.onCreated,
      browser.windows.onRemoved,
      browser.tabGroups.onUpdated,
    ] as { addListener: (callback: () => void) => void; removeListener: (callback: () => void) => void }[];
    load();
    for (const event of events) event.addListener(refresh);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      for (const event of events) event.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return state;
}
