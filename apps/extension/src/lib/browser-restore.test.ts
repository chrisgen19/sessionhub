import { browser, type Browser } from "wxt/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlannedWindow } from "@sessionhub/core/restore-plan";
import { inspectBrowserWindow, restoreBrowserWindow } from "./browser-restore";
import { BrowserError } from "./command-handlers";
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

describe("restoring into an open window", () => {
  it("appends every tab in background to that window, records each in order, and groups them there", async () => {
    const events: string[] = [];
    const tabsCreate = mockBrowser(events);
    const windowsCreate = vi.mocked(browser.windows.create);
    const group = vi.spyOn(browser.tabs, "group").mockImplementation(async () => 7);
    const updateGroup = vi.spyOn(browser.tabGroups, "update").mockImplementation(async () => ({}) as Browser.tabGroups.TabGroup);
    const window = plannedWindow(3);
    window.tabs[0]!.pinned = true;
    window.tabs[1]!.groupId = "g1";
    window.tabs[2]!.groupId = "g1";
    window.groups = [{ sourceGroupId: "g1", title: "Docs", color: "blue", collapsed: true }];
    const record = vi.fn(async (outcome: RestoreTabOutcome) => {
      events.push(`record ${outcome.sourceTabId}`);
    });

    const outcomes = await restoreBrowserWindow(window, record, { into: 42 });

    expect(windowsCreate).not.toHaveBeenCalled();
    expect(tabsCreate.mock.calls.map(([data]) => data)).toEqual([
      { windowId: 42, url: "https://t0.test/", pinned: true, active: false },
      { windowId: 42, url: "https://t1.test/", pinned: false, active: false },
      { windowId: 42, url: "https://t2.test/", pinned: false, active: false },
    ]);
    expect(events).toEqual(["open https://t0.test/", "record t0", "open https://t1.test/", "record t1", "open https://t2.test/", "record t2"]);
    expect(outcomes.map(({ status }) => status)).toEqual(["opened", "opened", "opened"]);
    expect(group).toHaveBeenCalledWith({ tabIds: [101, 102], createProperties: { windowId: 42 } });
    expect(updateGroup).toHaveBeenCalledWith(7, { title: "Docs", color: "blue", collapsed: true });
  });

  it("records a tab the closed window couldn't take as failed and keeps going", async () => {
    const tabsCreate = mockBrowser([]);
    tabsCreate.mockRejectedValueOnce(new Error("No window with id: 42"));
    const outcomes = await restoreBrowserWindow(plannedWindow(2), vi.fn(async () => {}), { into: 42 });
    expect(outcomes).toEqual([
      { sourceTabId: "t0", status: "failed", error: "The window was closed before this tab could open" },
      { sourceTabId: "t1", status: "opened" },
    ]);
  });
});

describe("inspectBrowserWindow", () => {
  const windowWith = (overrides: Partial<Browser.windows.Window>) =>
    vi.spyOn(browser.windows, "get").mockImplementation(async () => ({ id: 42, incognito: false, type: "normal", tabs: [], ...overrides }) as Browser.windows.Window);

  it("returns the urls open in a normal window, including ones still loading", async () => {
    windowWith({ tabs: [{ url: "https://a.test/" }, { url: "", pendingUrl: "https://b.test/" }, { url: "" }] as Browser.tabs.Tab[] });
    expect(await inspectBrowserWindow(42)).toEqual({ openUrls: ["https://a.test/", "https://b.test/"] });
  });

  it("refuses a closed, private or non-normal window", async () => {
    vi.spyOn(browser.windows, "get").mockRejectedValueOnce(new Error("No window with id: 42"));
    await expect(inspectBrowserWindow(42)).rejects.toThrow(new BrowserError("That window is no longer open, so nothing was opened"));
    windowWith({ incognito: true });
    await expect(inspectBrowserWindow(42)).rejects.toThrow("SessionHub doesn't open tabs in private windows");
    windowWith({ type: "popup" });
    await expect(inspectBrowserWindow(42)).rejects.toThrow("Tabs can only be opened in a normal browser window");
  });
});
