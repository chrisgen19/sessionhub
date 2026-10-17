import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionExport } from "@sessionhub/core/session-export";
import { getDb } from "../lib/db";
import { listSessions, putSession } from "../lib/session-repository";
import { sampleSession } from "../lib/test-fixtures";
import { ManagerApp } from "./manager/manager-app";

// Route commands straight to the real handler (no background worker in jsdom).
vi.mock("../lib/message-client", async () => {
  const { handleCommand } = await import("../lib/command-handlers");
  const { getDb: db } = await import("../lib/db");
  return {
    sendCommand: (command: unknown) =>
      handleCommand(command, {
        db: db(),
        readWindows: async () => [],
        restoreWindow: async () => [],
        now: () => new Date("2026-10-17T00:00:00.000Z"),
        createId: () => crypto.randomUUID(),
      }),
  };
});

const exportFile = (mutate?: (file: ReturnType<typeof createSessionExport>) => void) => {
  const file = createSessionExport(sampleSession(), new Date("2026-10-16T09:00:00.000Z"));
  mutate?.(file);
  return new File([JSON.stringify(file)], "sessionhub-client-alpha-2026-10-16.json", { type: "application/json" });
};

const chooseFile = async (file: File) => {
  render(<ManagerApp />);
  await screen.findByText(/no saved sessions yet|1 session/i);
  await userEvent.upload(screen.getByLabelText("Import a SessionHub export file"), file);
  return screen.findByRole("dialog");
};

beforeEach(async () => {
  await Promise.all(getDb().tables.map((table) => table.clear()));
  window.history.replaceState(null, "", "/manager.html");
});

describe("import", () => {
  it("previews the file, then imports it as a new session alongside the original", async () => {
    const original = sampleSession();
    await putSession(getDb(), original);
    const dialog = await chooseFile(exportFile());

    expect(within(dialog).getByRole("heading", { name: "Import session" })).toBeTruthy();
    expect(within(dialog).getByText(original.name)).toBeTruthy();
    expect(within(dialog).getByText(/2 windows · 4 tabs/)).toBeTruthy();
    expect(within(dialog).getByText(/1 tab can't be reopened/)).toBeTruthy();
    expect(within(dialog).getByText(/added as a new session/i)).toBeTruthy();

    await userEvent.click(within(dialog).getByRole("button", { name: "Import session" }));
    const inspector = await screen.findByRole("article", { name: /session details/i });
    expect(within(inspector).getByText(/imported from this browser/i)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();

    const sessions = await listSessions(getDb());
    expect(sessions).toHaveLength(2);
    expect(sessions.find((session) => session.id === original.id)).toEqual(original);
  });

  it("explains why a file can't be imported and stores nothing", async () => {
    const dialog = await chooseFile(new File(['{"format":"other"}'], "notes.json", { type: "application/json" }));
    expect(within(dialog).getByRole("heading", { name: "Can't import this file" })).toBeTruthy();
    expect(within(dialog).getByRole("alert").textContent).toMatch(/isn't a SessionHub session export/);
    expect(within(dialog).queryByRole("button", { name: "Import session" })).toBeNull();
    expect(await listSessions(getDb())).toEqual([]);
  });

  it("renders untrusted names and titles as text, never markup", async () => {
    const payload = '<img src=x onerror="window.__pwned=1">';
    const dialog = await chooseFile(
      exportFile((file) => {
        file.session.name = payload;
        file.session.windows[0]!.tabs[0]!.title = payload;
      }),
    );
    expect(within(dialog).getByText(payload)).toBeTruthy();
    expect(dialog.querySelector("img[src='x']")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Import session" }));
    const inspector = await screen.findByRole("article", { name: /session details/i });
    expect(inspector.querySelector("img[src='x']")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});
