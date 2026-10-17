import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountScope } from "../lib/account-scope";
import { getDb, type LocalWorkspaceRecord } from "../lib/db";
import { listOutbox } from "../lib/outbox-repository";
import { putSession } from "../lib/session-repository";
import { connectAs, sampleSession, seedAccountSession } from "../lib/test-fixtures";
import { ManagerApp } from "./manager/manager-app";

const ALICE = "AliceAccount00000000000000000000";
const SCOPE = accountScope(ALICE);
const ALPHA = "4b1f3c2e-8d7a-4e6b-9c5d-1a2b3c4d5e6f";
const T0 = "2026-10-16T08:00:00.000Z";

// The real worker handler with an offline network: uploads can't reach the server, changes stay queued.
vi.mock("../lib/message-client", async () => {
  const { handleCommand } = await import("../lib/command-handlers");
  const { getDb: db } = await import("../lib/db");
  return {
    sendCommand: (command: unknown) =>
      handleCommand(command, {
        db: db(),
        readWindows: async () => [],
        restoreWindow: async () => [],
        now: () => new Date(T0),
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

const workspace = (fields: Partial<LocalWorkspaceRecord> = {}): LocalWorkspaceRecord => ({
  id: ALPHA,
  scope: SCOPE,
  name: "Client Alpha",
  description: null,
  icon: null,
  color: "blue",
  position: 0,
  createdAt: T0,
  updatedAt: T0,
  sync: { serverVersion: 2, state: "synced" },
  deletedAt: null,
  ...fields,
});

/** Connected with sync on: one account session in Client Alpha, one in none, and one only in this browser. */
const seed = async () => {
  const db = getDb();
  await connectAs(db, ALICE);
  await db.syncState.put({ scope: SCOPE, enabledAt: T0, cursor: "c1.1.AAAAAAAAAAAAAAAAAAAAAA", lastSyncAt: T0, lastError: null, failures: 0, nextAttemptAt: null });
  await db.workspaces.put(workspace());
  const inAlpha = sampleSession({ name: "Alpha research", updatedAt: "2026-10-16T07:00:00.000Z" }, 1);
  const loose = sampleSession({ name: "Loose ends", updatedAt: "2026-10-16T06:00:00.000Z" }, 2);
  const mine = sampleSession({ name: "Only here", updatedAt: "2026-10-16T05:00:00.000Z" }, 3);
  await seedAccountSession(db, ALICE, inAlpha, { serverVersion: 3, state: "synced" });
  await db.sessions.update(inAlpha.id, { workspaceId: ALPHA });
  await seedAccountSession(db, ALICE, loose, { serverVersion: 1, state: "synced" });
  await db.sessions.update(loose.id, { workspaceId: null });
  await putSession(db, mine);
  return { inAlpha, loose, mine };
};

const sessionNames = () => within(screen.getByRole("list", { name: "Saved sessions" })).getAllByRole("button").map((row) => row.querySelector("span[title]")?.textContent);

beforeEach(async () => {
  await Promise.all(getDb().tables.map((table) => table.clear()));
  window.history.replaceState(null, "", "/manager.html");
});

describe("workspace switcher and assignment", () => {
  it("filters the list by workspace and puts an account session in one from the inspector", async () => {
    const { inAlpha, loose, mine } = await seed();
    render(<ManagerApp />);

    const switcher = await screen.findByRole("combobox", { name: "Workspace" });
    expect(within(switcher).getAllByRole("option").map((option) => option.textContent)).toEqual(["All sessions", "Client Alpha (1)", "No workspace (2)"]);
    expect(await screen.findByText(/Client Alpha ·/)).toBeTruthy();

    await userEvent.selectOptions(switcher, ALPHA);
    expect(sessionNames()).toEqual(["Alpha research"]);
    expect(window.location.hash).toBe(`#workspace=${ALPHA}`);
    await userEvent.selectOptions(switcher, "none");
    expect(sessionNames()).toEqual(["Loose ends", "Only here"]);

    await userEvent.click(screen.getByRole("button", { name: /Loose ends/ }));
    const inspector = await screen.findByRole("article", { name: /session details/i });
    // The picker shows once its own live query has loaded the workspaces.
    await userEvent.selectOptions(await within(inspector).findByRole("combobox", { name: "Workspace" }), ALPHA);
    await vi.waitFor(async () => expect((await getDb().sessions.get(loose.id))?.workspaceId).toBe(ALPHA));
    expect(await listOutbox(getDb(), SCOPE)).toMatchObject([{ entityId: loose.id, expectedVersion: 1, payload: { workspaceId: ALPHA } }]);
    // The filter stays, so the moved session leaves the "No workspace" list.
    await vi.waitFor(() => expect(sessionNames()).toEqual(["Only here"]));

    window.history.replaceState(null, "", `/manager.html#session=${mine.id}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByText(/Only sessions in your account can be in a workspace/)).toBeTruthy();
    expect((await getDb().sessions.get(inAlpha.id))?.workspaceId).toBe(ALPHA);
  });

  it("creates, edits and deletes workspaces, saying that sessions move out and nothing is deleted", async () => {
    const { inAlpha } = await seed();
    render(<ManagerApp />);
    await userEvent.click(await screen.findByRole("button", { name: "Manage workspaces" }));
    const dialog = screen.getByRole("dialog", { name: "Workspaces" });
    expect(within(dialog).getByText(/no tabs open or close/)).toBeTruthy();

    const create = within(dialog).getByRole("form", { name: "New workspace" });
    await userEvent.type(within(create).getByRole("textbox", { name: "Workspace name" }), "Research");
    await userEvent.selectOptions(within(create).getByRole("combobox", { name: "Color" }), "green");
    await userEvent.click(within(create).getByRole("button", { name: "Add workspace" }));
    const list = within(dialog).getByRole("list", { name: "Your workspaces" });
    expect(await within(list).findByText("Research")).toBeTruthy();
    expect(within(list).getByText(/0 sessions · Waiting to sync/)).toBeTruthy();

    await userEvent.click(within(list).getByRole("button", { name: "Edit Research" }));
    const name = within(list).getByRole("textbox", { name: "Workspace name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Deep research");
    await userEvent.click(within(list).getByRole("button", { name: "Save" }));
    expect(await within(list).findByText("Deep research")).toBeTruthy();

    await userEvent.click(within(list).getByRole("button", { name: "Delete Client Alpha" }));
    const confirm = within(list).getByRole("group", { name: "Delete Client Alpha" });
    expect(within(confirm).getByText(/Its 1 session moves to No workspace\. No session is deleted and no tabs close/)).toBeTruthy();
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete workspace" }));
    await vi.waitFor(() => expect(within(list).queryByText("Client Alpha")).toBeNull());
    expect((await getDb().sessions.get(inAlpha.id))?.workspaceId).toBeNull();
    expect(await getDb().sessions.count()).toBe(3);

    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    // The new workspace was selected when it was created: its empty state says how to fill it.
    expect(await screen.findByText("No sessions in Deep research")).toBeTruthy();
  });

  it("lists a workspace the account refused under Needs review, with a way to remove it", async () => {
    await seed();
    const db = getDb();
    await db.workspaces.put(workspace({ id: "5c2a4d3f-9e8b-4f7c-8d6e-2b3c4d5e6f70", name: "Too many", sync: { serverVersion: null, state: "error", lastError: "You can have up to 100 workspaces." } }));
    await db.outbox.add({ id: "6d3b5e4a-0f9c-4a8d-9e7f-3c4d5e6f7081", scope: SCOPE, entityType: "workspace", entityId: "5c2a4d3f-9e8b-4f7c-8d6e-2b3c4d5e6f70", action: "upsert", expectedVersion: 0, payload: { name: "Too many" }, status: "rejected", createdAt: T0, updatedAt: T0, attempts: 1, nextAttemptAt: null, lastError: "You can have up to 100 workspaces.", lastErrorCode: "LIMIT_REACHED" });
    window.history.replaceState(null, "", "/manager.html#view=account");
    render(<ManagerApp />);

    const review = await screen.findByRole("list", { name: "Changes to review" });
    expect(within(review).getByText("Not added to your account: You can have up to 100 workspaces.")).toBeTruthy();
    await userEvent.click(within(review).getByRole("button", { name: "Remove workspace" }));
    await vi.waitFor(() => expect(screen.queryByRole("list", { name: "Changes to review" })).toBeNull());
    expect(await db.outbox.count()).toBe(0);
  });

  it("offers no workspaces while this browser isn't connected", async () => {
    await putSession(getDb(), sampleSession({ name: "Only here" }, 3));
    render(<ManagerApp />);
    expect(await screen.findByText("Only here")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Workspace" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage workspaces" })).toBeNull();
  });
});
