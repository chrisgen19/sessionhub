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

describe("restore failures", () => {
  it("keeps opened tabs successful when pinning and grouping fail", async () => {
    const events: string[] = [];
    const tabsCreate = mockBrowser(events);
    vi.spyOn(browser.tabs, "update").mockImplementation(async () => {
      events.push("pin");
      throw new Error("No tab with id: 100");
    });
    vi.spyOn(browser.tabs, "group").mockRejectedValue(new Error("group failed"));
    const window = plannedWindow(2);
    window.tabs[0]!.pinned = true;
    window.tabs[1]!.groupId = "g1";
    window.groups = [{ sourceGroupId: "g1", title: "Group", color: "blue", collapsed: false }];
    const record = vi.fn(async (outcome: RestoreTabOutcome) => { events.push(`record ${outcome.sourceTabId}`); });

    expect(await restoreBrowserWindow(window, record)).toEqual([
      { sourceTabId: "t0", status: "opened" }, { sourceTabId: "t1", status: "opened" },
    ]);
    expect(events.slice(0, 3)).toEqual(["open https://t0.test/", "record t0", "pin"]);
    expect(tabsCreate).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("records a failed tab and continues with the next tab", async () => {
    const tabsCreate = mockBrowser([]);
    tabsCreate.mockRejectedValueOnce(new Error("No window with id: 1"));
    const record = vi.fn(async () => {});
    expect((await restoreBrowserWindow(plannedWindow(3), record)).map(({ status }) => status)).toEqual(["opened", "failed", "opened"]);
    expect(record).toHaveBeenCalledTimes(3);
  });

  it("reports all tabs failed if window creation fails, without opening more tabs", async () => {
    const tabsCreate = mockBrowser([]);
    vi.spyOn(browser.windows, "create").mockRejectedValue(new Error("window failed"));
    const record = vi.fn(async () => {});
    expect((await restoreBrowserWindow(plannedWindow(3), record)).map(({ status }) => status)).toEqual(["failed", "failed", "failed"]);
    expect(tabsCreate).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
