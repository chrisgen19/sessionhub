import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureWindowInput } from "@sessionhub/core/capture";
import { getDb } from "../lib/db";
import { runCheckpoint } from "../lib/recovery-checkpoint";
import { sampleWindows } from "../lib/test-fixtures";
import { ManagerApp } from "./manager/manager-app";
import { PopupApp } from "./popup/popup-app";

// The save picker's open windows (WXT's fake browser has no tab events to read them live).
vi.mock("../hooks/use-open-windows", async () => {
  const { sampleOpenWindows } = await import("../lib/test-fixtures");
  // One stable value, as the real hook keeps until Chrome reports a change.
  const state = { status: "ready", windows: sampleOpenWindows(), currentWindowId: 1 };
  return { useOpenWindows: () => state };
});

let windows: CaptureWindowInput[] = sampleWindows();

const deps = async () => {
  const { getDb: db } = await import("../lib/db");
  return {
    db: db(),
    readWindows: async () => windows,
    restoreWindow: async () => [],
    now: () => new Date(),
    createId: () => crypto.randomUUID(),
  };
};

// Route commands straight to the real handler with fake browser adapters.
vi.mock("../lib/message-client", async () => {
  const { handleCommand } = await import("../lib/command-handlers");
  return { sendCommand: async (command: unknown) => handleCommand(command, await deps()) };
});

const quota = () => Dexie.Promise.reject(new Dexie.QuotaExceededError("The quota has been exceeded."));

beforeEach(async () => {
  await Promise.all(getDb().tables.map((table) => table.clear()));
  windows = sampleWindows();
});
afterEach(() => vi.restoreAllMocks());

describe("storage full in the UI", () => {
  it("popup save explains that storage is full and what to do", async () => {
    vi.spyOn(getDb().sessions, "put").mockImplementation(quota);
    render(<PopupApp />);
    await userEvent.click(screen.getByRole("tab", { name: "Save" }));
    // Save is enabled once the picker can say where the session goes.
    await screen.findByText("Saves in this browser only.");
    await userEvent.click(screen.getByRole("button", { name: "Save 2 tabs" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Not saved: Storage for SessionHub is full, so this wasn't saved\. Delete or export sessions/);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("Checkpoint now says when older checkpoints were removed to make room", async () => {
    for (let index = 0; index < 4; index += 1) {
      windows = [{ tabs: [{ url: `https://s${index}.test/`, title: "s", pinned: false, index: 0, groupKey: null }], groups: [] }];
      await runCheckpoint(await deps(), { force: true, reason: "automatic" });
    }
    windows = sampleWindows();
    vi.spyOn(getDb().recoverySnapshots, "add").mockImplementationOnce(quota);
    window.history.replaceState(null, "", "/manager.html#view=recovery");
    render(<ManagerApp />);

    await userEvent.click(await screen.findByRole("button", { name: "Checkpoint now" }));
    expect(
      await screen.findByText("Checkpoint saved. Storage was full, so 2 older checkpoints were removed to make room."),
    ).toBeTruthy();
  });

  it("Recovery view shows the storage-full error when a checkpoint can't be saved", async () => {
    vi.spyOn(getDb().recoverySnapshots, "add").mockImplementation(quota);
    window.history.replaceState(null, "", "/manager.html#view=recovery");
    render(<ManagerApp />);
    await userEvent.click(await screen.findByRole("button", { name: "Checkpoint now" }));
    expect(await screen.findByText(/storage for SessionHub is full, so this checkpoint wasn't saved/i)).toBeTruthy();
  });
});
