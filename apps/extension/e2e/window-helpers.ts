import type { Page, Worker } from "@playwright/test";
import type { browser } from "wxt/browser";
import { expect, SITE } from "./fixtures";

// The extension's `chrome` global inside evaluate().
declare const chrome: typeof browser;

/** Window and tab helpers for E2E specs that build windows through the extension's worker. */

export interface WindowSpec {
  /** Page names served by the fixture site, in tab order. */
  pages: string[];
  pinned?: string[];
  group?: { title: string; pages: string[] };
}

/** Opens a normal window with these pages, pinned tabs and one named group; returns its id and tab ids. */
export const openWindow = (worker: Worker, spec: WindowSpec) =>
  worker.evaluate(
    async ({ site, spec }) => {
      const window = await chrome.windows.create({ url: spec.pages.map((page) => `${site}/${page}`) });
      const tabs = window!.tabs!;
      const idOf = (page: string) => tabs[spec.pages.indexOf(page)]!.id!;
      for (const page of spec.pinned ?? []) await chrome.tabs.update(idOf(page), { pinned: true });
      if (spec.group) {
        const tabIds = spec.group.pages.map(idOf) as [number, ...number[]];
        const groupId = (await chrome.tabs.group({ tabIds, createProperties: { windowId: window!.id! } })) as number;
        await chrome.tabGroups.update(groupId, { title: spec.group.title, color: "blue" });
      }
      return { windowId: window!.id!, tabIds: tabs.map((tab) => tab.id!) };
    },
    { site: SITE, spec },
  );

/** A window's tabs in strip order: page name, pinned, and its group's title. */
export const readWindow = (worker: Worker, windowId: number) =>
  worker.evaluate(
    async ({ site, windowId }) => {
      const tabs = await chrome.tabs.query({ windowId });
      const groups = new Map((await chrome.tabGroups.query({ windowId })).map((group) => [group.id, group.title]));
      return tabs
        .sort((a, b) => a.index - b.index)
        .map((tab) => ({
          page: (tab.url || tab.pendingUrl || "").replace(`${site}/`, ""),
          pinned: tab.pinned,
          group: tab.groupId === -1 ? null : (groups.get(tab.groupId) ?? "untitled"),
        }));
    },
    { site: SITE, windowId },
  );

export const windowIds = (worker: Worker) => worker.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ["normal"] })).map((window) => window.id!));

export const send = (page: Page, message: unknown) => page.evaluate((message) => chrome.runtime.sendMessage(message), message);

export const countRestoreJobs = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open("sessionhub");
        request.onsuccess = () => {
          const count = request.result.transaction("restoreJobs").objectStore("restoreJobs").count();
          count.onsuccess = () => resolve(count.result);
        };
      }),
  );

/** True once every tab in the window has finished loading with a committed URL. */
export const loaded = (worker: Worker, windowId: number) =>
  worker.evaluate(async (windowId) => (await chrome.tabs.query({ windowId })).every((tab) => tab.status === "complete" && tab.url !== ""), windowId);

/** Saves exactly these tabs once they have loaded: mid-navigation, a tab's url and pendingUrl can both be empty. */
export const saveTabs = async (worker: Worker, manager: Page, windows: { windowId: number; tabIds: number[] }[]) => {
  for (const { windowId, tabIds } of windows) {
    await expect.poll(() => loaded(worker, windowId)).toBe(true);
    expect(tabIds.length).toBeGreaterThan(0);
  }
  const saved = await send(manager, { type: "session.capture", scope: { kind: "tabs", tabIds: windows.flatMap((window) => window.tabIds) } });
  expect(saved).toMatchObject({ ok: true });
  return (saved as { data: { sessionId: string } }).data.sessionId;
};
