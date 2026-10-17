import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountScope } from "../lib/account-scope";
import { getDb } from "../lib/db";
import { listOutbox } from "../lib/outbox-repository";
import { listSessions } from "../lib/session-repository";
import { connectAs } from "../lib/test-fixtures";
import { ManagerApp } from "./manager/manager-app";

const ALICE = "AliceAccount00000000000000000000";
const T0 = "2026-10-17T08:00:00.000Z";

// Open windows for the picker; WXT's fake browser has no tab events to read them live.
vi.mock("../hooks/use-open-windows", async () => {
  const { sampleOpenWindows } = await import("../lib/test-fixtures");
  const state = { status: "ready", windows: sampleOpenWindows(), currentWindowId: 1 };
  return { useOpenWindows: () => state };
});

// The real worker handler; its capture keeps only the ticked tabs, as browser-capture does.
vi.mock("../lib/message-client", async () => {
  const { handleCommand } = await import("../lib/command-handlers");
  const { getDb: db } = await import("../lib/db");
  const { sampleOpenWindows } = await import("../lib/test-fixtures");
  const { selectTabs } = await import("../lib/tab-selection");
  return {
    sendCommand: (command: unknown) =>
      handleCommand(command, {
        db: db(),
        readWindows: async (scope) =>
          (scope.kind === "tabs" ? selectTabs(sampleOpenWindows(), scope.tabIds) : sampleOpenWindows()).map((window) => ({
            groups: window.groups.map((group) => ({ key: group.id, title: group.title, color: group.color, collapsed: false })),
            tabs: window.tabs.map((tab, index) => ({ url: tab.url, title: tab.title, pinned: tab.pinned, index, groupKey: tab.groupId })),
          })),
        restoreWindow: async () => [],
        now: () => new Date(T0),
        createId: () => crypto.randomUUID(),
      }),
  };
});

const checkbox = (name: RegExp | string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
const savedTitles = async () => (await listSessions(getDb()))[0]?.windows.map((window) => window.tabs.map((tab) => tab.title));

beforeEach(async () => {
  await Promise.all(getDb().tables.map((table) => table.clear()));
  window.history.replaceState(null, "", "/manager.html#view=open-tabs");
});

describe("save picker", () => {
  it("opens with this window ticked (browser pages unticked) and saves exactly what the user ticked, under their name", async () => {
    render(<ManagerApp />);
    expect(checkbox(/^Window 1/).checked).toBe(true);
    expect(checkbox(/^Window 2/).checked).toBe(false);
    expect(checkbox(/Settings/).checked).toBe(false);
    expect(screen.getByText("2 tabs in 1 window selected")).toBeTruthy();
    expect(await screen.findByText("Saves in this browser only.")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Window 1" })).getByText("Won't reopen")).toBeTruthy();

    await userEvent.click(checkbox(/React docs/));
    expect(checkbox(/^Window 1/).indeterminate).toBe(true);
    await userEvent.click(checkbox(/^Window 2/));
    expect(screen.getByText("2 tabs in 2 windows selected")).toBeTruthy();
    const name = screen.getByRole("textbox", { name: "Session name" });
    expect((name as HTMLInputElement).value).toMatch(/^2 windows, /);
    await userEvent.clear(name);
    await userEvent.type(name, "Picked by hand");
    await userEvent.click(screen.getByRole("button", { name: "Save 2 tabs" }));

    expect(await screen.findByText("Saved locally: 2 tabs in 2 windows.")).toBeTruthy();
    expect(await savedTitles()).toEqual([["Fix login PR"], ["Example"]]);
    expect((await listSessions(getDb()))[0]?.name).toBe("Picked by hand");
    // Ready for the next save: back to this window, with the default name.
    expect(checkbox(/^Window 1/).checked).toBe(true);
  });

  it("ticks a whole window from its header, a browser page only by hand, and a range with Shift-click", async () => {
    // One session, so the Shift held by keyboard() applies to the click.
    const user = userEvent.setup();
    render(<ManagerApp />);
    await user.click(checkbox(/^Window 1/));
    expect(screen.getByText("No tabs selected")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save tabs" }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(checkbox(/Fix login PR/));
    await user.keyboard("{Shift>}");
    await user.click(checkbox(/Settings/));
    await user.keyboard("{/Shift}");
    expect([checkbox(/Fix login PR/), checkbox(/React docs/), checkbox(/Settings/)].map((box) => box.checked)).toEqual([true, true, true]);
    expect(screen.getByText(/1 browser page kept for reference only/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Select none" }));
    await userEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("3 tabs in 2 windows selected")).toBeTruthy();
    expect(checkbox(/Settings/).checked).toBe(false);
  });

  it("says before saving that it goes to the account when sync is on, and queues only those tabs", async () => {
    const db = getDb();
    await connectAs(db, ALICE);
    await db.syncState.put({ scope: accountScope(ALICE), enabledAt: T0, cursor: null, lastSyncAt: null, lastError: null, failures: 0, nextAttemptAt: null });
    render(<ManagerApp />);

    expect(await screen.findByText("Saves to your account: it uploads at the next sync.")).toBeTruthy();
    await userEvent.click(checkbox(/React docs/));
    await userEvent.click(screen.getByRole("button", { name: "Save 1 tab" }));
    expect(await screen.findByText("Saved: 1 tab in 1 window. It will sync to your account.")).toBeTruthy();
    const [operation] = await listOutbox(db, accountScope(ALICE));
    expect(operation?.entityType === "savedSession" && operation.action === "upsert" && operation.payload.windows.flatMap((window) => window.tabs.map((tab) => tab.url))).toEqual([
      "https://github.com/acme/pull/42",
    ]);
  });

  it("hides and shows a window's tabs without changing what is ticked", async () => {
    render(<ManagerApp />);
    await userEvent.click(screen.getByRole("button", { name: "Hide the tabs of Window 1" }));
    expect(screen.queryByRole("checkbox", { name: /React docs/ })).toBeNull();
    expect(screen.getByText("2 tabs in 1 window selected")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show the tabs of Window 1" }));
    expect(checkbox(/React docs/).checked).toBe(true);
  });
});
