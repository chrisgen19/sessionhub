import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureWindowInput } from "@sessionhub/core/capture";
import { getDb, type RestoreTabOutcome } from "../lib/db";
import { runCheckpoint } from "../lib/recovery-checkpoint";
import { sampleWindows } from "../lib/test-fixtures";
import { ManagerApp } from "./manager/manager-app";

let windows: CaptureWindowInput[] = sampleWindows();
const restoredUrls: string[] = [];

const deps = async () => {
  const { getDb: db } = await import("../lib/db");
  return {
    db: db(),
    readWindows: async () => windows,
    restoreWindow: async (window: { tabs: { sourceTabId: string; url: string }[] }) =>
      window.tabs.map((tab): RestoreTabOutcome => {
        restoredUrls.push(tab.url);
        return { sourceTabId: tab.sourceTabId, status: "opened" };
      }),
    now: () => new Date(),
    createId: () => crypto.randomUUID(),
  };
};

// Route commands straight to the real handler with fake browser adapters.
vi.mock("../lib/message-client", async () => {
  const { handleCommand } = await import("../lib/command-handlers");
  return { sendCommand: async (command: unknown) => handleCommand(command, await deps()) };
});

const checkpoint = async () => runCheckpoint(await deps(), { force: true, reason: "automatic" });

beforeEach(async () => {
  await Promise.all(getDb().tables.map((table) => table.clear()));
  windows = sampleWindows();
  restoredUrls.length = 0;
  window.history.replaceState(null, "", "/manager.html#view=recovery");
});

describe("Recovery view", () => {
  it("explains checkpoints and shows an empty state", async () => {
    render(<ManagerApp />);
    expect(await screen.findByText(/automatic checkpoints appear as you browse/i)).toBeTruthy();
    expect(screen.getByText(/never uploaded/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Recovery" }).getAttribute("aria-current")).toBe("page");
  });

  it("lists checkpoints newest first under Today with change summaries", async () => {
    await checkpoint();
    windows = [{ ...windows[0]!, tabs: windows[0]!.tabs.slice(0, 2) }, windows[1]!];
    await checkpoint();
    render(<ManagerApp />);

    const today = await screen.findByRole("region", { name: "Today" });
    const rows = within(today).getAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toMatch(/2 windows · 3 tabs · 1 closed/);
    expect(rows[1]!.textContent).toMatch(/2 windows · 4 tabs$/);
  });

  it("takes a checkpoint on demand and reports when nothing changed", async () => {
    render(<ManagerApp />);
    await screen.findByText(/automatic checkpoints appear/i);
    await userEvent.click(screen.getByRole("button", { name: "Checkpoint now" }));
    expect(await screen.findByText("Checkpoint saved.")).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Today" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Checkpoint now" }));
    expect(await screen.findByText(/nothing changed since the last checkpoint/i)).toBeTruthy();
  });

  it("inspects a checkpoint and opens it from its tree", async () => {
    const result = await checkpoint();
    const snapshotId = "snapshotId" in result ? result.snapshotId : null;
    window.history.replaceState(null, "", `/manager.html#view=recovery&snapshot=${snapshotId}`);
    render(<ManagerApp />);

    const inspector = await screen.findByRole("article", { name: /checkpoint details/i });
    expect(within(inspector).getByText(/saved automatically/i)).toBeTruthy();
    expect(within(inspector).getByRole("list", { name: "Group Docs" })).toBeTruthy();

    await userEvent.click(within(inspector).getByRole("button", { name: /^Open 3 tabs in \d new windows?$/ }));
    expect(await within(inspector).findByText(/opened 3 of 3 tabs/i)).toBeTruthy();
    expect(restoredUrls).toEqual(["https://github.com/acme/pull/42", "https://react.dev/learn", "https://example.com/"]);
  });
});
