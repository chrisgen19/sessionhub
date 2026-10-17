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
  it("starts on Open with an empty state, and the Save tab has the picker with this window ticked", async () => {
    render(<PopupApp />);
    expect(await screen.findByText("Local only")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Open" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("No saved sessions yet. Save tabs from the Save tab to get started.")).toBeTruthy();

    await userEvent.click(screen.getByRole("tab", { name: "Save" }));
    const save = screen.getByRole("tabpanel", { name: "Save" });
    expect((within(save).getByRole("checkbox", { name: /Window 1/ }) as HTMLInputElement).checked).toBe(true);
    expect(within(save).getByRole("button", { name: "Save 2 tabs" })).toBeTruthy();
    expect(within(save).getByRole("button", { name: "Open full view" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save window|save all/i })).toBeNull();
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

  it("ticks windows and tabs, can't tick tabs that won't reopen, and remembers where to open", async () => {
    const session = sampleSession();
    await putSession(getDb(), session);
    window.history.replaceState(null, "", `/manager.html#session=${session.id}`);
    render(<ManagerApp />);

    const inspector = await screen.findByRole("article", { name: /session details/i });
    expect(within(inspector).getByRole("button", { name: "Open 3 tabs in 2 new windows" })).toBeTruthy();
    expect(within(inspector).getByText("3 of 3 tabs · 2 windows")).toBeTruthy();
    expect((within(inspector).getByRole("checkbox", { name: /Settings/ }) as HTMLInputElement).disabled).toBe(true);
    expect(within(inspector).getByRole("link", { name: "React docs" }).getAttribute("href")).toBe("https://react.dev/learn");
    expect(within(inspector).queryByRole("link", { name: "Settings" })).toBeNull();

    await userEvent.click(within(inspector).getByRole("checkbox", { name: /window 2/i }));
    expect(within(inspector).getByRole("button", { name: "Open 2 tabs in 1 new window" })).toBeTruthy();
    await userEvent.click(within(inspector).getByRole("checkbox", { name: /React docs/ }));
    expect(within(inspector).getByRole("button", { name: "Open 1 tab in 1 new window" })).toBeTruthy();
    expect((within(inspector).getByRole("checkbox", { name: /window 1/i }) as HTMLInputElement).indeterminate).toBe(true);

    await userEvent.click(within(inspector).getByRole("button", { name: "Choose where to open" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "This window" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(within(inspector).getByRole("button", { name: "Open 1 tab in this window" })).toBeTruthy();
    expect((within(inspector).getByRole("checkbox", { name: "Skip tabs already open here" }) as HTMLInputElement).checked).toBe(true);
    expect(localStorage.getItem("sessionhub-open-target")).toBe("this-window");

    await userEvent.click(within(inspector).getByRole("button", { name: "Select none" }));
    expect(within(inspector).getByText("No tabs selected")).toBeTruthy();
    expect((within(inspector).getByRole("button", { name: "Open" }) as HTMLButtonElement).disabled).toBe(true);
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
