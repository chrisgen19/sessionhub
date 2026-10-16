import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannedWindow } from "@sessionhub/core/restore-plan";
import { getDb, type RestoreTabOutcome } from "../lib/db";
import { putSession } from "../lib/session-repository";
import { sampleSession } from "../lib/test-fixtures";
import { ManagerApp } from "./manager/manager-app";

/** Every tab handed to the fake browser, across all attempts. */
const opened: string[] = [];
let failAfterFirstTab = true;

const fakeRestoreWindow = async (window: PlannedWindow): Promise<RestoreTabOutcome[]> =>
  window.tabs.map((tab, index) => {
    if (failAfterFirstTab && index > 0) return { sourceTabId: tab.sourceTabId, status: "failed", error: "No window with id: 7" };
    opened.push(tab.url);
    return { sourceTabId: tab.sourceTabId, status: "opened" };
  });

// Route commands straight to the real handler with a fake browser adapter.
vi.mock("../lib/message-client", async () => {
  const { handleCommand } = await import("../lib/command-handlers");
  const { getDb: db } = await import("../lib/db");
  return {
    sendCommand: (command: unknown) =>
      handleCommand(command, {
        db: db(),
        readWindows: async () => [],
        restoreWindow: (window) => fakeRestoreWindow(window),
        now: () => new Date(),
        createId: () => crypto.randomUUID(),
      }),
  };
});

beforeEach(async () => {
  await Promise.all(getDb().tables.map((table) => table.clear()));
  opened.length = 0;
  failAfterFirstTab = true;
});

describe("restore retry", () => {
  it("shows failures, retries only them, and then offers no further retry", async () => {
    const session = sampleSession();
    await putSession(getDb(), session);
    window.history.replaceState(null, "", `/manager.html#session=${session.id}`);
    render(<ManagerApp />);

    await userEvent.click(await screen.findByRole("button", { name: /restore/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Restore 3 tabs" }));

    expect(await within(dialog).findByText(/opened 2 of 3 tabs/i)).toBeTruthy();
    expect(within(dialog).getByText(/1 tab didn't open/i)).toBeTruthy();
    expect(within(dialog).getByText(/React docs: No window with id: 7/)).toBeTruthy();
    expect(opened).toEqual(["https://github.com/acme/pull/42", "https://example.com/"]);

    failAfterFirstTab = false;
    await userEvent.click(within(dialog).getByRole("button", { name: "Retry 1 tab" }));
    expect(await within(dialog).findByText(/opened 3 of 3 tabs after 2 attempts/i)).toBeTruthy();
    expect(opened).toEqual(["https://github.com/acme/pull/42", "https://example.com/", "https://react.dev/learn"]);
    expect(within(dialog).queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("keeps the summary and shows why when a retry is refused", async () => {
    const session = sampleSession();
    await putSession(getDb(), session);
    window.history.replaceState(null, "", `/manager.html#session=${session.id}`);
    render(<ManagerApp />);
    await userEvent.click(await screen.findByRole("button", { name: /restore/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Restore 3 tabs" }));
    await within(dialog).findByText(/opened 2 of 3 tabs/i);

    // Another manager tab already finished retrying this job.
    const [job] = await getDb().restoreJobs.toArray();
    await getDb().restoreJobs.put({ ...job!, status: "completed" });

    await userEvent.click(within(dialog).getByRole("button", { name: "Retry 1 tab" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/already opened/);
    expect(within(dialog).getByText(/opened 2 of 3 tabs/i)).toBeTruthy();
  });

  it("reopens the last restore's summary from the inspector and retries from there", async () => {
    const session = sampleSession();
    await putSession(getDb(), session);
    window.history.replaceState(null, "", `/manager.html#session=${session.id}`);
    render(<ManagerApp />);

    await userEvent.click(await screen.findByRole("button", { name: /restore/i }));
    let dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Restore 3 tabs" }));
    await within(dialog).findByText(/opened 2 of 3 tabs/i);
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    const inspector = screen.getByRole("article", { name: /session details/i });
    expect(await within(inspector).findByText(/last restore today, .*: opened 2 of 3/i)).toBeTruthy();
    await userEvent.click(within(inspector).getByRole("button", { name: "View summary" }));
    dialog = screen.getByRole("dialog", { name: `Last restore of "${session.name}"` });
    expect(within(dialog).getByText(/React docs: No window with id: 7/)).toBeTruthy();

    failAfterFirstTab = false;
    await userEvent.click(within(dialog).getByRole("button", { name: "Retry 1 tab" }));
    expect(await within(dialog).findByText(/opened 3 of 3 tabs after 2 attempts/i)).toBeTruthy();
    expect(await within(inspector).findByText(/last restore today, .*: opened all 3/i)).toBeTruthy();
  });

  it("explains an interrupted restore that a later worker settled", async () => {
    const session = sampleSession();
    await putSession(getDb(), session);
    const { planRestore } = await import("@sessionhub/core/restore-plan");
    const { settleInterruptedJobs } = await import("../lib/restore-job-repository");
    const plan = planRestore(session);
    await getDb().restoreJobs.add({
      id: crypto.randomUUID(),
      sessionId: session.id,
      createdAt: "2026-10-16T08:00:00.000Z",
      updatedAt: "2026-10-16T08:00:00.000Z",
      status: "running",
      plan,
      outcomes: [{ sourceTabId: plan.windows[0]!.tabs[0]!.sourceTabId, status: "opened" }],
      attempts: 1,
    });
    await settleInterruptedJobs(getDb(), new Date("2026-10-16T09:00:00.000Z"), new Date("2026-10-16T09:00:00.000Z"));

    window.history.replaceState(null, "", `/manager.html#session=${session.id}`);
    render(<ManagerApp />);
    const inspector = await screen.findByRole("article", { name: /session details/i });
    expect(await within(inspector).findByText(/opened 1 of 3, interrupted/i)).toBeTruthy();
    await userEvent.click(within(inspector).getByRole("button", { name: "View summary" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/this restore was cut off/i)).toBeTruthy();
    expect(within(dialog).getByText(/2 tabs weren't reached/i)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Retry 2 tabs" })).toBeTruthy();
  });
});

