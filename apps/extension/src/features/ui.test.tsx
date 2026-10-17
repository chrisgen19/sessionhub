import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../lib/db";
import { putSession } from "../lib/session-repository";
import { sampleSession } from "../lib/test-fixtures";
import { ManagerApp } from "./manager/manager-app";
import { PopupApp } from "./popup/popup-app";

// The save picker's open windows (WXT's fake browser has no tab events to read them live).
vi.mock("../hooks/use-open-windows", async () => {
  const { sampleOpenWindows } = await import("../lib/test-fixtures");
  // One stable value, as the real hook keeps until Chrome reports a change.
  const state = { status: "ready", windows: sampleOpenWindows(), currentWindowId: 1 };
  return { useOpenWindows: () => state };
});

beforeEach(async () => {
  await Promise.all(getDb().tables.map((table) => table.clear()));
  window.history.replaceState(null, "", "/");
});

describe("PopupApp", () => {
  it("shows the local-only state, the save picker with this window ticked, and an empty state", async () => {
    render(<PopupApp />);
    expect(await screen.findByText("Local only")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /Window 1/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Save 2 tabs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open full view" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save window|save all/i })).toBeNull();
    expect(await screen.findByText(/no saved sessions yet/i)).toBeTruthy();
  });

  it("lists recent sessions and filters them by tab content", async () => {
    await putSession(getDb(), sampleSession({ name: "Client Alpha research" }, 1));
    await putSession(getDb(), sampleSession({ name: "Weekend reading", updatedAt: "2026-10-15T08:00:00.000Z" }, 2));
    render(<PopupApp />);
    expect(await screen.findByText("Client Alpha research")).toBeTruthy();
    expect(screen.getByText("Weekend reading")).toBeTruthy();

    await userEvent.type(screen.getByRole("searchbox", { name: /search saved sessions/i }), "alpha");
    expect(screen.getByRole("heading", { name: "Matching sessions" })).toBeTruthy();
    expect(screen.queryByText("Weekend reading")).toBeNull();
  });
});

describe("ManagerApp", () => {
  it("opens a deep-linked session with its window tree and restore warnings", async () => {
    const session = sampleSession();
    await putSession(getDb(), session);
    window.history.replaceState(null, "", `/manager.html#session=${session.id}`);
    render(<ManagerApp />);

    const inspector = await screen.findByRole("article", { name: /session details/i });
    expect(within(inspector).getByRole("heading", { name: session.name })).toBeTruthy();
    expect(within(inspector).getByText(/1 tab can't be reopened/i)).toBeTruthy();
    expect(within(inspector).getByRole("region", { name: "Window 1" })).toBeTruthy();
    expect(within(inspector).getByRole("list", { name: "Group Docs" })).toBeTruthy();
  });

  it("previews a restore in new windows, lists skipped tabs and respects window selection", async () => {
    const session = sampleSession();
    await putSession(getDb(), session);
    window.history.replaceState(null, "", `/manager.html#session=${session.id}`);
    render(<ManagerApp />);

    await userEvent.click(await screen.findByRole("button", { name: /restore/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/opens in new windows/i)).toBeTruthy();
    expect(within(dialog).getByText(/1 tab can't be restored/i)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Restore 3 tabs" })).toBeTruthy();

    await userEvent.click(within(dialog).getByRole("checkbox", { name: /window 2/i }));
    expect(within(dialog).getByRole("button", { name: "Restore 2 tabs" })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /window 1/i }));
    expect((within(dialog).getByRole("button", { name: "Restore 0 tabs" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("requires explicit confirmation before deleting", async () => {
    const session = sampleSession();
    await putSession(getDb(), session);
    window.history.replaceState(null, "", `/manager.html#session=${session.id}`);
    render(<ManagerApp />);

    await userEvent.click(await screen.findByRole("button", { name: /^delete$/i }));
    const dialog = screen.getByRole("dialog", { name: `Delete "${session.name}"?` });
    expect(within(dialog).getByText(/tabs you have open right now are not affected/i)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await getDb().sessions.count()).toBe(1);
  });
});
