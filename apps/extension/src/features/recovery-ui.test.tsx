import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureWindowInput } from "@sessionhub/core/capture";
import { accountScope } from "../lib/account-scope";
import { getDb, type RestoreTabOutcome } from "../lib/db";
import { listOutbox } from "../lib/outbox-repository";
import { runCheckpoint } from "../lib/recovery-checkpoint";
import { listSessions } from "../lib/session-repository";
import { connectAs, sampleWindows } from "../lib/test-fixtures";
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

  it("saves a checkpoint as a session once and links to it", async () => {
    const result = await checkpoint();
    const snapshotId = "snapshotId" in result ? result.snapshotId : null;
    window.history.replaceState(null, "", `/manager.html#view=recovery&snapshot=${snapshotId}`);
    render(<ManagerApp />);

    const inspector = await screen.findByRole("article", { name: /checkpoint details/i });
    expect(await within(inspector).findByText(/to keep this one, save it as a session\. Saves in this browser only\./i)).toBeTruthy();
    await userEvent.click(within(inspector).getByRole("button", { name: "Save as session" }));

    expect(await within(inspector).findByText(/saved locally as a session/i)).toBeTruthy();
    expect(within(inspector).getByRole("button", { name: "Saved as session" }).hasAttribute("disabled")).toBe(true);
    const [saved] = await listSessions(getDb());
    expect(saved?.id).not.toBe(snapshotId);
    expect(within(inspector).getByRole("link", { name: "View session" }).getAttribute("href")).toBe(`#session=${saved!.id}`);
    expect(await listSessions(getDb())).toHaveLength(1);
  });

  it("says before saving that the copy goes to the account when sync is on, then queues only the copy", async () => {
    const alice = "AliceAccount00000000000000000000";
    await connectAs(getDb(), alice);
    await getDb().syncState.put({ scope: accountScope(alice), enabledAt: "2026-10-17T08:00:00.000Z", cursor: null, lastSyncAt: null, lastError: null, failures: 0, nextAttemptAt: null });
    const result = await checkpoint();
    const snapshotId = "snapshotId" in result ? result.snapshotId : null;
    window.history.replaceState(null, "", `/manager.html#view=recovery&snapshot=${snapshotId}`);
    render(<ManagerApp />);

    const inspector = await screen.findByRole("article", { name: /checkpoint details/i });
    expect(await within(inspector).findByText(/Saves to your account: it uploads at the next sync\./)).toBeTruthy();
    await userEvent.click(within(inspector).getByRole("button", { name: "Save as session" }));
    expect(await within(inspector).findByText(/Saved as a session\. It will sync to your account\./)).toBeTruthy();
    const [saved] = await listSessions(getDb());
    expect((await listOutbox(getDb(), accountScope(alice))).map((operation) => operation.entityId)).toEqual([saved!.id]);
  });
});
