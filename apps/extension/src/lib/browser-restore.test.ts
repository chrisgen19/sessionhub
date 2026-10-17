import { browser, type Browser } from "wxt/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlannedWindow } from "@sessionhub/core/restore-plan";
import { restoreBrowserWindow } from "./browser-restore";
import type { RestoreTabOutcome } from "./db";

const plannedWindow = (count: number): PlannedWindow => ({
  sourceWindowId: "w1",
  tabs: Array.from({ length: count }, (_, index) => ({ sourceTabId: `t${index}`, url: `https://t${index}.test/`, pinned: false, groupId: null })),
  groups: [],
});

/** Logs every browser side effect so tests can check what happened before each outcome was recorded. */
const mockBrowser = (events: string[]) => {
  let nextTabId = 100;
  vi.spyOn(browser.windows, "create").mockImplementation(async (data) => {
    events.push(`open ${String(data?.url)}`);
    return { id: 1, tabs: [{ id: nextTabId++ }] } as Browser.windows.Window;
  });
  return vi.spyOn(browser.tabs, "create").mockImplementation(async (data) => {
    events.push(`open ${String(data.url)}`);
    return { id: nextTabId++ } as Browser.tabs.Tab;
  });
};

afterEach(() => vi.restoreAllMocks());

describe("restoreBrowserWindow", () => {
  it("records each tab's outcome before it opens the next tab", async () => {
    const events: string[] = [];
    mockBrowser(events);
    const record = vi.fn(async (outcome: RestoreTabOutcome) => {
      events.push(`record ${outcome.sourceTabId}`);
    });

    const outcomes = await restoreBrowserWindow(plannedWindow(3), record);

    expect(events).toEqual([
      "open https://t0.test/",
      "record t0",
      "open https://t1.test/",
      "record t1",
      "open https://t2.test/",
      "record t2",
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["opened", "opened", "opened"]);
  });

  it("stops opening tabs once an outcome can't be recorded", async () => {
    const tabsCreate = mockBrowser([]);
    const record = vi.fn(async (outcome: RestoreTabOutcome) => {
      if (outcome.sourceTabId === "t1") throw new Error("disk full");
    });

    await expect(restoreBrowserWindow(plannedWindow(4), record)).rejects.toThrow("disk full");
    expect(tabsCreate).toHaveBeenCalledTimes(1);
  });
});
