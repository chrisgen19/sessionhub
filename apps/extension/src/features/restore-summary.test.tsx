import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { planRestore, withoutOpenTabs, type RestoreDestination, type RestorePlan } from "@sessionhub/core/restore-plan";
import { getDb, type RestoreJobRecord } from "../lib/db";
import { sampleSession } from "../lib/test-fixtures";
import { LastRestore } from "./manager/last-restore";
import { RestoreSummary } from "./manager/restore-summary";

const session = sampleSession();

/** A finished job in which every planned tab opened. */
const finishedJob = (plan: RestorePlan, target?: RestoreDestination): RestoreJobRecord => ({
  id: "00000000-0000-4000-8000-0000000000aa",
  sessionId: session.id,
  createdAt: "2026-10-17T08:00:00.000Z",
  updatedAt: "2026-10-17T08:00:00.000Z",
  status: "completed",
  plan,
  outcomes: plan.windows.flatMap((window) => window.tabs.map((tab) => ({ sourceTabId: tab.sourceTabId, status: "opened" as const }))),
  attempts: 1,
  ...(target ? { target } : {}),
});

const renderSummary = (job: RestoreJobRecord) =>
  render(<RestoreSummary session={session} job={job} retrying={false} retryError={null} onRetry={() => {}} onClose={() => {}} />);

beforeEach(async () => {
  await Promise.all(getDb().tables.map((table) => table.clear()));
});

describe("restore summary destinations", () => {
  it("says where the tabs went", () => {
    const { unmount } = renderSummary(finishedJob(planRestore(session)));
    expect(screen.getByText("Opened 3 of 3 tabs in 2 new windows.")).toBeTruthy();
    unmount();
    const merged = renderSummary(finishedJob(planRestore(session, { layout: "single" }), "one-window"));
    expect(screen.getByText("Opened 3 of 3 tabs in 1 new window.")).toBeTruthy();
    merged.unmount();
    renderSummary(finishedJob(planRestore(session, { layout: "single" }), "this-window"));
    expect(screen.getByText("Opened 3 of 3 tabs in this window.")).toBeTruthy();
  });

  it("lists tabs that were already open in this window, by title", () => {
    const plan = withoutOpenTabs(planRestore(session, { layout: "single" }), new Set(["https://react.dev/learn"]));
    renderSummary(finishedJob(plan, "this-window"));
    expect(screen.getByText("Opened 2 of 2 tabs in this window.")).toBeTruthy();
    expect(screen.getByText("1 tab already open in this window, so not opened again")).toBeTruthy();
    expect(screen.getByText("React docs")).toBeTruthy();
  });

  it("says there was nothing to open when every tab was already open", async () => {
    const plan = withoutOpenTabs(planRestore(session, { layout: "single" }), new Set(["https://github.com/acme/pull/42", "https://react.dev/learn", "https://example.com/"]));
    const job = finishedJob(plan, "this-window");
    renderSummary(job);
    expect(screen.getByText("Nothing to open: every tab you chose is already open in this window.")).toBeTruthy();
    expect(screen.queryByText(/Opened 0/)).toBeNull();

    await getDb().restoreJobs.put(job);
    render(<LastRestore session={session} />);
    expect(await screen.findByText(/everything was already open/)).toBeTruthy();
  });
});
