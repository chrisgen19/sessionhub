import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { browser, type Browser } from "wxt/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSavedSession } from "@sessionhub/core/capture";
import type { HandlerDeps } from "../lib/command-handlers";
import { getDb, type RestoreTabOutcome } from "../lib/db";
import { putSession } from "../lib/session-repository";
import { idFactory, sampleSession } from "../lib/test-fixtures";
import { PopupApp } from "./popup/popup-app";

// The save picker's open windows (WXT's fake browser has no tab events to read them live).
vi.mock("../hooks/use-open-windows", async () => {
  const { sampleOpenWindows } = await import("../lib/test-fixtures");
  const state = { status: "ready", windows: sampleOpenWindows(), currentWindowId: 1 };
  return { useOpenWindows: () => state };
});

/** What the fake browser was asked to open, and into which window. */
const calls: { urls: string[]; into: number | undefined }[] = [];
let failAfterFirstTab = false;

// Route commands straight to the real handler with a fake browser adapter.
vi.mock("../lib/message-client", async () => {
  const { handleCommand } = await import("../lib/command-handlers");
  const { getDb: db } = await import("../lib/db");
  const inspectWindow: NonNullable<HandlerDeps["inspectWindow"]> = async () => ({ openUrls: [] });
  return {
    sendCommand: (command: unknown) =>
      handleCommand(command, {
        db: db(),
        readWindows: async () => [],
        restoreWindow: async (window, _record, options) => {
          calls.push({ urls: window.tabs.map((tab) => tab.url), into: options?.into });
          return window.tabs.map((tab, index): RestoreTabOutcome =>
            failAfterFirstTab && index > 0 ? { sourceTabId: tab.sourceTabId, status: "failed", error: "No window with id: 7" } : { sourceTabId: tab.sourceTabId, status: "opened" },
          );
        },
        inspectWindow,
        now: () => new Date(),
        createId: () => crypto.randomUUID(),
      }),
  };
});

beforeEach(async () => {
  await Promise.all(getDb().tables.map((table) => table.clear()));
  calls.length = 0;
  failAfterFirstTab = false;
  vi.spyOn(browser.windows, "getCurrent").mockImplementation(async () => ({ id: 3 }) as Browser.windows.Window);
});

afterEach(() => vi.restoreAllMocks());

describe("popup tabs", () => {
  it("remembers the tab used last and moves between tabs with the arrow keys", async () => {
    const { unmount } = render(<PopupApp />);
    await userEvent.click(screen.getByRole("tab", { name: "Save" }));
    expect(localStorage.getItem("sessionhub-popup-tab")).toBe("save");
    unmount();

    render(<PopupApp />);
    const save = screen.getByRole("tab", { name: "Save" });
    expect(save.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Save" })).toBeTruthy();
    save.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Open" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Open" }));
    // The hidden Save panel stays mounted, so its ticks and name survive.
    expect(document.getElementById("popup-panel-save")?.hidden).toBe(true);
  });
});

describe("popup Open tab", () => {
  it("opens a whole session from its row into this window and says so", async () => {
    localStorage.setItem("sessionhub-open-target", "this-window");
    await putSession(getDb(), sampleSession());
    render(<PopupApp />);

    expect(await screen.findByText(/Open puts all of a session's tabs in this window/)).toBeTruthy();
    await userEvent.click(await screen.findByRole("button", { name: 'Open "Client Alpha research" (3 tabs) in this window' }));
    expect(await screen.findByText("Opened 3 of 3 tabs in this window.")).toBeTruthy();
    expect(calls).toEqual([{ urls: ["https://github.com/acme/pull/42", "https://react.dev/learn", "https://example.com/"], into: 3 }]);
  });

  it("points to the manager when some tabs didn't open", async () => {
    failAfterFirstTab = true;
    const create = vi.spyOn(browser.tabs, "create").mockImplementation(async () => ({}) as Browser.tabs.Tab);
    vi.spyOn(window, "close").mockImplementation(() => {});
    const session = sampleSession();
    await putSession(getDb(), session);
    render(<PopupApp />);

    await userEvent.click(await screen.findByRole("button", { name: 'Open "Client Alpha research" (3 tabs) in 2 new windows' }));
    expect(await screen.findByText(/Opened 2 of 3 tabs in 2 new windows\./)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "See what didn't open" }));
    expect(create).toHaveBeenCalledWith({ url: expect.stringMatching(new RegExp(`manager\\.html#session=${session.id}$`)) });
  });

  it("asks before opening more than 50 tabs from a row", async () => {
    const big = buildSavedSession(
      [{ tabs: Array.from({ length: 60 }, (_, index) => ({ url: `https://site${index}.test/`, title: `Page ${index}`, pinned: false, index, groupKey: null })), groups: [] }],
      { name: "Big research", now: new Date("2026-10-17T08:00:00.000Z"), device: { id: "0d6f6a4e-2f0c-4a43-8f5b-2a7e9a0c1d11", name: "This browser" }, createId: idFactory(9) },
    ).session;
    await putSession(getDb(), big);
    render(<PopupApp />);

    await userEvent.click(await screen.findByRole("button", { name: 'Open "Big research" (60 tabs) in 1 new window' }));
    const confirm = screen.getByRole("alertdialog", { name: "Confirm opening" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(calls).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: 'Open "Big research" (60 tabs) in 1 new window' }));
    await userEvent.click(screen.getByRole("button", { name: "Open 60 tabs" }));
    expect(await screen.findByText("Opened 60 of 60 tabs in 1 new window.")).toBeTruthy();
  });

  it("taps into a session to choose tabs, with the search's matches, and comes back", async () => {
    await putSession(getDb(), sampleSession());
    render(<PopupApp />);
    await userEvent.type(await screen.findByRole("searchbox", { name: /search saved sessions/i }), "react");
    await userEvent.click(screen.getByRole("button", { name: /^Client Alpha research/ }));

    const panel = screen.getByRole("region", { name: "Open tabs" });
    expect(within(panel).getByRole("button", { name: "Open 3 tabs in 2 new windows" })).toBeTruthy();
    await userEvent.click(within(panel).getByRole("button", { name: "Select matches (1)" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Open 1 tab in 1 new window" }));
    expect(await within(panel).findByText("Opened 1 of 1 tab in 1 new window.")).toBeTruthy();
    expect(calls).toEqual([{ urls: ["https://react.dev/learn"], into: undefined }]);

    await userEvent.click(screen.getByRole("button", { name: "All sessions" }));
    expect(screen.getByRole("heading", { name: "Matching sessions" })).toBeTruthy();
  });
});
