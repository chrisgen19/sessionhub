import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSavedSession } from "@sessionhub/core/capture";
import { getDb } from "../lib/db";
import { getSession, putSession } from "../lib/session-repository";
import { idFactory, sampleSession } from "../lib/test-fixtures";
import { ManagerApp } from "./manager/manager-app";

const T0 = "2026-10-18T08:00:00.000Z";

// The real worker handler, with this browser's sessions only (no account).
vi.mock("../lib/message-client", async () => {
  const { handleCommand } = await import("../lib/command-handlers");
  const { getDb: db } = await import("../lib/db");
  return {
    sendCommand: (command: unknown) =>
      handleCommand(command, { db: db(), readWindows: async () => [], restoreWindow: async () => [], now: () => new Date(T0), createId: () => crypto.randomUUID() }),
  };
});

const list = () => screen.getByRole("list", { name: "Saved sessions" });
const sessionNames = () => within(list()).getAllByRole("button").map((row) => row.querySelector("span[title]")?.textContent);

/** Four sessions of this browser: one pinned, one archived, two tagged. */
const seed = async () => {
  const db = getDb();
  const sessions = {
    beta: sampleSession({ name: "Beta notes", updatedAt: "2026-10-17T08:00:00.000Z", tags: ["work"] }, 1),
    alpha: sampleSession({ name: "Alpha plan", updatedAt: "2026-10-16T08:00:00.000Z", tags: ["Work", "q4"] }, 2),
    pinned: sampleSession({ name: "Zeta pinned", updatedAt: "2026-10-15T08:00:00.000Z", isPinned: true }, 3),
    old: sampleSession({ name: "Old trip", updatedAt: "2026-10-14T08:00:00.000Z", isArchived: true }, 4),
  };
  for (const session of Object.values(sessions)) await putSession(db, session);
  return sessions;
};

beforeEach(async () => {
  await Promise.all(getDb().tables.map((table) => table.clear()));
  localStorage.clear();
  window.history.replaceState(null, "", "/manager.html");
});

describe("sort, filters and archive in the list", () => {
  it("puts pinned sessions first, sorts as chosen (remembered), filters by tag, and keeps archived sessions apart", async () => {
    await seed();
    render(<ManagerApp />);
    await waitFor(() => expect(sessionNames()).toEqual(["Zeta pinned", "Beta notes", "Alpha plan"]));
    expect(screen.getByRole("button", { name: "Active 3" }).getAttribute("aria-pressed")).toBe("true");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "name");
    expect(sessionNames()).toEqual(["Zeta pinned", "Alpha plan", "Beta notes"]);
    expect(localStorage.getItem("sessionhub-session-sort")).toBe("name");

    const tag = screen.getByRole("combobox", { name: "Tag" });
    expect(within(tag).getAllByRole("option").map((option) => option.textContent)).toEqual(["All tags", "q4 (1)", "work (2)"]);
    await userEvent.selectOptions(tag, "q4");
    expect(sessionNames()).toEqual(["Alpha plan"]);
    await userEvent.selectOptions(tag, "");

    await userEvent.click(screen.getByRole("button", { name: "Archived 1" }));
    expect(sessionNames()).toEqual(["Old trip"]);
  });

  it("finds sessions by tag in the search", async () => {
    await seed();
    render(<ManagerApp />);
    await userEvent.type(await screen.findByRole("searchbox"), "q4");
    await waitFor(() => expect(sessionNames()).toEqual(["Alpha plan"]));
  });
});

describe("bulk actions", () => {
  it("ticks a range with Shift, archives them, then tags and deletes after confirming", async () => {
    const { beta, alpha, pinned } = await seed();
    render(<ManagerApp />);
    await waitFor(() => expect(sessionNames()).toHaveLength(3));

    // One user-event session, so the held Shift applies to the click.
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Select Zeta pinned" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("checkbox", { name: "Select Alpha plan" }));
    await user.keyboard("{/Shift}");
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByText("3 sessions selected")).toBeTruthy();

    await userEvent.click(within(bar).getByRole("button", { name: "Archive" }));
    expect(await screen.findByText("Archived 3 sessions.")).toBeTruthy();
    for (const session of [beta, alpha, pinned]) expect((await getSession(getDb(), session.id))?.isArchived).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Archived 4" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Beta notes" }));
    await userEvent.click(screen.getByRole("button", { name: "Tag…" }));
    const tagDialog = await screen.findByRole("dialog", { name: "Tag 1 session" });
    await userEvent.type(within(tagDialog).getByRole("combobox", { name: "Tag" }), "travel");
    await userEvent.click(within(tagDialog).getByRole("button", { name: "Add tag" }));
    expect(await screen.findByText("Tagged 1 session “travel”.")).toBeTruthy();
    expect((await getSession(getDb(), beta.id))?.tags).toEqual(["work", "travel"]);

    await userEvent.click(screen.getByRole("checkbox", { name: "Select Beta notes" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Old trip" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete 2 sessions?" });
    expect(within(confirm).getByText("Beta notes")).toBeTruthy();
    expect(within(confirm).getByText("Old trip")).toBeTruthy();
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete 2 sessions" }));
    expect(await screen.findByText("Deleted 2 sessions.")).toBeTruthy();
    expect(await getSession(getDb(), beta.id)).toBeUndefined();
  });
});

describe("the inspector", () => {
  it("pins, tags, adds notes, duplicates and archives the open session", async () => {
    const { beta } = await seed();
    window.history.replaceState(null, "", `/manager.html#session=${beta.id}`);
    render(<ManagerApp />);
    const inspector = await screen.findByRole("article", { name: "Session details" });

    await userEvent.click(within(inspector).getByRole("button", { name: "Pin" }));
    await waitFor(() => expect(within(inspector).getByRole("button", { name: "Unpin" }).getAttribute("aria-pressed")).toBe("true"));
    await waitFor(() => expect(sessionNames()[0]).toBe("Beta notes"));

    await userEvent.type(within(inspector).getByRole("combobox", { name: "Add a tag" }), "reading{Enter}");
    expect(await within(inspector).findByRole("button", { name: "Remove tag reading" })).toBeTruthy();

    await userEvent.click(within(inspector).getByRole("button", { name: "Add notes" }));
    await userEvent.type(within(inspector).getByRole("textbox", { name: "Notes" }), "Finish chapter 3");
    await userEvent.click(within(inspector).getByRole("button", { name: "Save notes" }));
    expect(await within(inspector).findByText("Finish chapter 3")).toBeTruthy();
    expect(await getSession(getDb(), beta.id)).toMatchObject({ isPinned: true, tags: ["work", "reading"], description: "Finish chapter 3" });
    expect(within(inspector).getByText(/Most tabs from/)).toBeTruthy();

    await userEvent.click(within(inspector).getByRole("button", { name: "Duplicate" }));
    expect(await screen.findByRole("heading", { name: "Beta notes (copy)" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByText("Archived", { selector: "span" })).toBeTruthy();
  });

  it("never overwrites notes changed elsewhere while editing, but a pin meanwhile doesn't block saving", async () => {
    const { alpha } = await seed();
    window.history.replaceState(null, "", `/manager.html#session=${alpha.id}`);
    render(<ManagerApp />);
    const inspector = await screen.findByRole("article", { name: "Session details" });
    const { handleCommand } = await import("../lib/command-handlers");
    const elsewhere = async (command: Record<string, unknown>) => {
      const current = await getSession(getDb(), alpha.id);
      await handleCommand({ ...command, sessionId: alpha.id, expectedVersion: current!.version }, { db: getDb(), readWindows: async () => [], restoreWindow: async () => [], now: () => new Date(T0), createId: () => crypto.randomUUID() });
    };

    await userEvent.click(within(inspector).getByRole("button", { name: "Add notes" }));
    await userEvent.type(within(inspector).getByRole("textbox", { name: "Notes" }), "Mine");
    // Another manager tab saves notes first.
    await elsewhere({ type: "session.edit", description: "Theirs" });
    await userEvent.click(within(inspector).getByRole("button", { name: "Save notes" }));
    expect(await within(inspector).findByText(/changed in another window/)).toBeTruthy();
    expect(within(inspector).getByText("Theirs")).toBeTruthy();
    expect((await getSession(getDb(), alpha.id))?.description).toBe("Theirs");
    // Saving again, knowingly, replaces them; a pin from elsewhere in between doesn't get in the way.
    await elsewhere({ type: "session.edit", isPinned: true });
    await userEvent.click(within(inspector).getByRole("button", { name: "Save notes" }));
    await waitFor(async () => expect(await getSession(getDb(), alpha.id)).toMatchObject({ description: "Mine", isPinned: true }));
  });

  it("unticks extra copies of the same page in the open picker", async () => {
    const urls = ["https://a.test/", "https://b.test/", "https://a.test/"];
    const session = buildSavedSession([{ tabs: urls.map((url, index) => ({ url, title: `Tab ${index}`, pinned: false, index, groupKey: null })), groups: [] }], {
      name: "Copies",
      now: new Date(T0),
      device: { id: "0d6f6a4e-2f0c-4a43-8f5b-2a7e9a0c1d11", name: "This browser" },
      createId: idFactory(5),
    }).session;
    await putSession(getDb(), session);
    window.history.replaceState(null, "", `/manager.html#session=${session.id}`);
    render(<ManagerApp />);
    const inspector = await screen.findByRole("article", { name: "Session details" });
    expect(within(inspector).getByText(/1 tab is a copy of another tab/)).toBeTruthy();
    await userEvent.click(within(inspector).getByRole("button", { name: "Untick duplicates (1)" }));
    expect(within(inspector).getByText("2 of 3 tabs · 1 window")).toBeTruthy();
    expect(within(inspector).queryByRole("button", { name: /Untick duplicates/ })).toBeNull();
  });
});
