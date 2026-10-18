import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountScope } from "../lib/account-scope";
import { getDb } from "../lib/db";
import { putSession } from "../lib/session-repository";
import { connectAs, sampleSession } from "../lib/test-fixtures";
import { ManagerApp } from "./manager/manager-app";

const ALICE = "AliceAccount00000000000000000000";

// The real worker handler with an offline network: account checks and uploads can't reach the server.
vi.mock("../lib/message-client", async () => {
  const { handleCommand } = await import("../lib/command-handlers");
  const { getDb: db } = await import("../lib/db");
  return {
    sendCommand: (command: unknown) =>
      handleCommand(command, {
        db: db(),
        readWindows: async () => [],
        restoreWindow: async () => [],
        now: () => new Date("2026-10-16T08:00:00.000Z"),
        createId: () => crypto.randomUUID(),
        account: {
          fetch: async () => {
            throw new TypeError("fetch failed");
          },
          apiOrigin: "https://sessionhub.example",
          openTab: async () => undefined,
          platformOs: async () => "mac",
        },
        sync: { random: () => 1, scheduleRetry: async () => undefined },
      }),
  };
});

beforeEach(async () => {
  await Promise.all(getDb().tables.map((table) => table.clear()));
});

const chip = () => within(screen.getByRole("region", { name: "Sync" })).getByTitle(/./);

describe("sync opt-in and status", () => {
  it("previews what uploads, moves the chosen sessions, and reports status truthfully", async () => {
    const research = sampleSession({ name: "Research" }, 1);
    const reading = sampleSession({ name: "Reading" }, 2);
    await putSession(getDb(), research);
    await putSession(getDb(), reading);
    await connectAs(getDb(), ALICE);
    window.history.replaceState(null, "", "/manager.html#view=account");
    render(<ManagerApp />);

    const section = await screen.findByRole("region", { name: "Sync" });
    expect(within(section).getByText(/Sync is off\. Nothing is uploaded or downloaded/)).toBeTruthy();
    expect(chip().textContent).toBe("Sync off");

    await userEvent.click(within(section).getByRole("button", { name: "Turn on sync…" }));
    const dialog = screen.getByRole("dialog", { name: "Turn on sync" });
    expect(within(dialog).getByText(/the titles and links of their tabs, and each window's size, position and state are uploaded to your account on localhost:3000/)).toBeTruthy();
    const boxes = within(within(dialog).getByRole("list", { name: "Sessions to upload" })).getAllByRole("checkbox");
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([true, true]);
    expect(within(dialog).getByText("2 sessions · 8 tabs selected")).toBeTruthy();

    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Reading/ }));
    expect(within(dialog).getByText("1 session · 4 tabs selected")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Turn on sync and upload 1 session" }));

    expect(await within(section).findByText("Sync is on. Uploading 1 session to your account.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await getDb().sessions.get(research.id)).toMatchObject({ scope: accountScope(ALICE), sync: { serverVersion: null, state: "pending" } });
    expect((await getDb().sessions.get(reading.id))?.scope).toBe("local");
    expect(await getDb().outbox.count()).toBe(1);
    await vi.waitFor(() => expect(chip().textContent).toBe("Waiting to sync"));
    expect(within(section).getByRole("button", { name: "Upload sessions from this browser (1)" })).toBeTruthy();

    await userEvent.click(within(section).getByRole("button", { name: /Sync now/ }));
    expect(await within(section).findByText(/^Sync failed: Couldn't reach SessionHub/)).toBeTruthy();
    await vi.waitFor(() => expect(chip().textContent).toBe("Offline"));
    expect(within(section).getByRole("alert").textContent).toMatch(/Saving and restoring still work/);

    await userEvent.click(within(section).getByRole("button", { name: /Turn off sync/ }));
    await vi.waitFor(() => expect(chip().textContent).toBe("Sync off"));
    expect((await getDb().syncState.get(accountScope(ALICE)))?.enabledAt).toBeNull();
    expect(await getDb().outbox.count()).toBe(1);
  });

  it("labels each session and warns that deleting an account session reaches other browsers", async () => {
    const mine = sampleSession({ name: "Only here" }, 1);
    const shared = sampleSession({ name: "In the account" }, 2);
    await putSession(getDb(), mine);
    await connectAs(getDb(), ALICE);
    await getDb().sessions.put({ ...shared, scope: accountScope(ALICE), sync: { serverVersion: 2, state: "synced" } });
    await getDb().syncState.put({ scope: accountScope(ALICE), enabledAt: "2026-10-16T07:00:00.000Z", cursor: null, lastSyncAt: "2026-10-16T07:30:00.000Z", lastError: null, failures: 0, nextAttemptAt: null });
    window.history.replaceState(null, "", `/manager.html#session=${shared.id}`);
    render(<ManagerApp />);

    const list = await screen.findByRole("list", { name: "Saved sessions" });
    expect(within(list).getByRole("button", { name: /Only here/ }).textContent).toMatch(/Local only/);
    expect(within(list).getByRole("button", { name: /In the account/ }).textContent).toMatch(/Synced/);

    const inspector = await screen.findByRole("article", { name: /session details/i });
    expect(within(inspector).getByTitle(/the server has the latest version/).textContent).toBe("Synced");
    await userEvent.click(within(inspector).getByRole("button", { name: /Delete/ }));
    expect(within(screen.getByRole("dialog")).getByText(/from your account: your other connected browsers remove it at their next sync/)).toBeTruthy();
  });
});
