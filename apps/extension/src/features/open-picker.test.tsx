import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { browser, type Browser } from "wxt/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSavedSession } from "@sessionhub/core/capture";
import { BrowserError, type HandlerDeps } from "../lib/command-handlers";
import { getDb, type RestoreTabOutcome } from "../lib/db";
import { putSession } from "../lib/session-repository";
import { idFactory, sampleSession } from "../lib/test-fixtures";
import { ManagerApp } from "./manager/manager-app";

/** What the fake browser was asked to open, and into which window. */
const calls: { urls: string[]; into: number | undefined; lazy?: boolean }[] = [];
let inspectWindow: NonNullable<HandlerDeps["inspectWindow"]> = async () => ({ openUrls: [] });

// Route commands straight to the real handler with a fake browser adapter.
vi.mock("../lib/message-client", async () => {
  const { handleCommand } = await import("../lib/command-handlers");
  const { getDb: db } = await import("../lib/db");
  return {
    sendCommand: (command: unknown) =>
      handleCommand(command, {
        db: db(),
        readWindows: async () => [],
        restoreWindow: async (window, _record, options) => {
          calls.push({ urls: window.tabs.map((tab) => tab.url), into: options?.into, ...(options?.lazy ? { lazy: true } : {}) });
          return window.tabs.map((tab): RestoreTabOutcome => ({ sourceTabId: tab.sourceTabId, status: "opened" }));
        },
        inspectWindow: (windowId) => inspectWindow(windowId),
        now: () => new Date(),
        createId: () => crypto.randomUUID(),
      }),
  };
});

beforeEach(async () => {
  await Promise.all(getDb().tables.map((table) => table.clear()));
  calls.length = 0;
  inspectWindow = async () => ({ openUrls: [] });
  vi.spyOn(browser.windows, "getCurrent").mockImplementation(async () => ({ id: 5 }) as Browser.windows.Window);
});

afterEach(() => vi.restoreAllMocks());

const showSession = async (session = sampleSession()) => {
  await putSession(getDb(), session);
  window.history.replaceState(null, "", `/manager.html#session=${session.id}`);
  render(<ManagerApp />);
  return screen.findByRole("article", { name: /session details/i });
};

describe("open picker", () => {
  it("opens into this window, skipping tabs already open there", async () => {
    localStorage.setItem("sessionhub-open-target", "this-window");
    inspectWindow = async () => ({ openUrls: ["https://react.dev/learn"] });
    const inspector = await showSession();

    await userEvent.click(within(inspector).getByRole("button", { name: "Open 3 tabs in this window" }));
    expect(await within(inspector).findByText("Opened 2 of 2 tabs in this window.")).toBeTruthy();
    expect(within(inspector).getByText("1 tab already open in this window, so not opened again")).toBeTruthy();
    expect(calls).toEqual([{ urls: ["https://github.com/acme/pull/42", "https://example.com/"], into: 5 }]);
  });

  it("opens every chosen tab into this window when skipping is turned off, and remembers that", async () => {
    localStorage.setItem("sessionhub-open-target", "this-window");
    inspectWindow = async () => ({ openUrls: ["https://react.dev/learn"] });
    const inspector = await showSession();

    await userEvent.click(within(inspector).getByRole("checkbox", { name: "Skip tabs already open here" }));
    expect(localStorage.getItem("sessionhub-open-skip")).toBe("false");
    await userEvent.click(within(inspector).getByRole("button", { name: "Open 3 tabs in this window" }));
    expect(await within(inspector).findByText("Opened 3 of 3 tabs in this window.")).toBeTruthy();
  });

  it("puts only the ticked tabs in one new window", async () => {
    localStorage.setItem("sessionhub-open-target", "one-window");
    const inspector = await showSession();
    await userEvent.click(within(inspector).getByRole("checkbox", { name: /Fix login PR/ }));

    await userEvent.click(within(inspector).getByRole("button", { name: "Open 2 tabs in 1 new window" }));
    expect(await within(inspector).findByText("Opened 2 of 2 tabs in 1 new window.")).toBeTruthy();
    expect(calls).toEqual([{ urls: ["https://react.dev/learn", "https://example.com/"], into: undefined }]);
  });

  it("keeps tabs unloaded until clicked when asked, and remembers that", async () => {
    const inspector = await showSession();
    const lazy = within(inspector).getByRole("checkbox", { name: "Keep tabs unloaded until clicked" }) as HTMLInputElement;
    expect(lazy.checked).toBe(false);
    await userEvent.click(lazy);
    expect(localStorage.getItem("sessionhub-open-lazy")).toBe("true");

    await userEvent.click(within(inspector).getByRole("button", { name: "Open 3 tabs in 2 new windows" }));
    expect(await within(inspector).findByText("Opened 3 of 3 tabs in 2 new windows.")).toBeTruthy();
    expect(calls.map((call) => call.lazy)).toEqual([true, true]);
  });

  it("shows why nothing opened, and lets the message go", async () => {
    localStorage.setItem("sessionhub-open-target", "this-window");
    inspectWindow = async () => Promise.reject(new BrowserError("That window is no longer open, so nothing was opened"));
    const inspector = await showSession();

    await userEvent.click(within(inspector).getByRole("button", { name: "Open 3 tabs in this window" }));
    expect((await within(inspector).findByRole("alert")).textContent).toMatch(/Restore stopped: That window is no longer open/);
    expect(calls).toEqual([]);
    await userEvent.click(within(inspector).getByRole("button", { name: "Dismiss" }));
    expect(within(inspector).queryByRole("alert")).toBeNull();
  });

  it("asks before opening more than 50 tabs", async () => {
    const big = buildSavedSession(
      [{ tabs: Array.from({ length: 51 }, (_, index) => ({ url: `https://site${index}.test/`, title: `Page ${index}`, pinned: false, index, groupKey: null })), groups: [] }],
      { name: "Big research", now: new Date("2026-10-17T08:00:00.000Z"), device: { id: "0d6f6a4e-2f0c-4a43-8f5b-2a7e9a0c1d11", name: "This browser" }, createId: idFactory(9) },
    ).session;
    const inspector = await showSession(big);

    await userEvent.click(within(inspector).getByRole("button", { name: "Open 51 tabs in 1 new window" }));
    const confirm = within(inspector).getByRole("alertdialog", { name: "Confirm opening" });
    expect(within(confirm).getByText("Open 51 tabs?")).toBeTruthy();
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(calls).toEqual([]);

    await userEvent.click(within(inspector).getByRole("button", { name: "Open 51 tabs in 1 new window" }));
    await userEvent.click(within(inspector).getByRole("button", { name: "Open 51 tabs" }));
    expect(await within(inspector).findByText("Opened 51 of 51 tabs in 1 new window.")).toBeTruthy();
  });

  it("selects the tabs matching the list's search, and offers nothing when only the session name matches", async () => {
    const inspector = await showSession();
    const search = screen.getByRole("searchbox");

    await userEvent.type(search, "react");
    await userEvent.click(within(inspector).getByRole("button", { name: "Select matches (1)" }));
    expect(within(inspector).getByText("1 of 3 tabs · 1 window")).toBeTruthy();
    expect(within(inspector).getByRole("button", { name: "Open 1 tab in 1 new window" })).toBeTruthy();

    await userEvent.clear(search);
    await userEvent.type(search, "alpha");
    expect(within(inspector).queryByRole("button", { name: /select matches/i })).toBeNull();
  });

  it("ticks a range with Shift-click, skipping tabs that can't reopen, and keeps ticks across a new version", async () => {
    const session = sampleSession();
    const inspector = await showSession(session);
    // One session, so the Shift held by keyboard() applies to the click.
    const user = userEvent.setup();
    await user.click(within(inspector).getByRole("button", { name: "Select none" }));
    await user.click(within(inspector).getByRole("checkbox", { name: /Fix login PR/ }));
    await user.keyboard("{Shift>}");
    await user.click(within(inspector).getByRole("checkbox", { name: /Example/ }));
    await user.keyboard("{/Shift}");
    expect(within(inspector).getByText("3 of 3 tabs · 2 windows")).toBeTruthy();
    expect((within(inspector).getByRole("checkbox", { name: /Settings/ }) as HTMLInputElement).checked).toBe(false);

    await userEvent.click(within(inspector).getByRole("checkbox", { name: /React docs/ }));
    await putSession(getDb(), { ...session, name: "Renamed elsewhere", version: session.version + 1 });
    expect(await within(inspector).findByRole("heading", { name: "Renamed elsewhere" })).toBeTruthy();
    expect((within(inspector).getByRole("checkbox", { name: /React docs/ }) as HTMLInputElement).checked).toBe(false);
    expect(within(inspector).getByText("2 of 3 tabs · 2 windows")).toBeTruthy();
  });
});
