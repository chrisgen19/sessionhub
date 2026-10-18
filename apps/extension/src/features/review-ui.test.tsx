import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import type { SavedSession } from "@sessionhub/contracts/session";
import { accountScope } from "../lib/account-scope";
import { getDb, type OutboxRecord } from "../lib/db";
import { connectAs, sampleSession } from "../lib/test-fixtures";
import { ManagerApp } from "./manager/manager-app";

const ALICE = "AliceAccount00000000000000000000";
const SCOPE = accountScope(ALICE);
const NOW = "2026-10-16T08:00:00.000Z";

vi.mock("../lib/message-client", async () => {
  const { handleCommand } = await import("../lib/command-handlers");
  const { getDb: db } = await import("../lib/db");
  return {
    sendCommand: (command: unknown) =>
      handleCommand(command, {
        db: db(),
        readWindows: async () => [],
        restoreWindow: async () => [],
        now: () => new Date(NOW),
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

/** The other device's version: renamed, and its first tab points somewhere else. */
const theirs = (session: SavedSession): ApiSessionDetail => {
  const [first, ...rest] = session.windows;
  return {
    id: session.id,
    name: "Theirs",
    description: null,
    workspaceId: null,
    sourceDeviceId: "8c20b166-6156-4728-a9bc-10635ca68ca1",
    sourceDeviceName: "Chrome on Windows",
    isPinned: false,
    isArchived: false,
    tags: [],
    version: 5,
    tabCount: 4,
    windowCount: 2,
    createdAt: session.createdAt,
    updatedAt: "2026-10-16T07:30:00.000Z",
    windows: [{ ...first!, tabs: [{ ...first!.tabs[0]!, url: "https://elsewhere.test/" }, ...first!.tabs.slice(1)] }, ...rest],
  };
};

const refused = async (action: "upsert" | "delete") => {
  const db = getDb();
  await connectAs(db, ALICE);
  await db.syncState.put({ scope: SCOPE, enabledAt: NOW, cursor: null, lastSyncAt: NOW, lastError: null, failures: 0, nextAttemptAt: null });
  const session = sampleSession({ name: "Mine" }, 2);
  if (action === "upsert") await db.sessions.put({ ...session, scope: SCOPE, sync: { serverVersion: 3, state: "conflict" } });
  else await db.sessionTombstones.put({ id: session.id, scope: SCOPE, deletedAt: NOW });
  const fields = { id: crypto.randomUUID(), scope: SCOPE, entityType: "savedSession", entityId: session.id, expectedVersion: 3, status: "conflict", createdAt: NOW, updatedAt: NOW, attempts: 1, nextAttemptAt: null, lastError: "Changed elsewhere", lastErrorCode: "VERSION_CONFLICT", conflictServerVersion: 5 };
  await db.outbox.add({ ...fields, ...(action === "upsert" ? { action, payload: session } : { action, payload: null }) } as OutboxRecord);
  await db.serverCopies.put({ id: session.id, scope: SCOPE, action: "upsert", version: 5, payload: theirs(session), receivedAt: NOW });
  return session;
};

beforeEach(async () => {
  await Promise.all(getDb().tables.map((table) => table.clear()));
});

describe("conflict review", () => {
  it("compares both versions from the inspector and keeps both as separate sessions", async () => {
    const session = await refused("upsert");
    window.history.replaceState(null, "", `/manager.html#session=${session.id}`);
    render(<ManagerApp />);

    const inspector = await screen.findByRole("article", { name: /session details/i });
    expect(await within(inspector).findByText(/Both versions are kept until you choose/)).toBeTruthy();
    await userEvent.click(within(inspector).getByRole("button", { name: "Review…" }));

    const dialog = screen.getByRole("dialog", { name: 'Review "Mine"' });
    expect(within(dialog).getByText(/changed in this browser and somewhere else/)).toBeTruthy();
    expect(within(dialog).getByText("Theirs")).toBeTruthy();
    expect(within(dialog).getByText("From Chrome on Windows")).toBeTruthy();
    expect(within(dialog).getByText("1 link only here")).toBeTruthy();
    expect(within(dialog).getByText("https://elsewhere.test/")).toBeTruthy();
    const choices = within(within(dialog).getByRole("list", { name: "Choices" })).getAllByRole("button");
    expect(choices.map((choice) => choice.querySelector("span span")?.textContent)).toEqual(["Keep mine", "Keep the other version", "Keep both"]);

    await userEvent.click(within(dialog).getByRole("button", { name: /^Keep both/ }));
    const list = await screen.findByRole("list", { name: "Saved sessions" });
    await vi.waitFor(() => expect(within(list).getByRole("button", { name: /Mine \(this browser's version\)/ }).textContent).toMatch(/Waiting to sync/));
    expect(within(list).getByRole("button", { name: /^Theirs/ }).textContent).toMatch(/Synced/);
    expect(window.location.hash).not.toContain(session.id);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists a session deleted here but changed elsewhere in the Sync card, and can restore it", async () => {
    const session = await refused("delete");
    window.history.replaceState(null, "", "/manager.html#view=account");
    render(<ManagerApp />);

    const reviews = await screen.findByRole("list", { name: "Changes to review" });
    expect(within(reviews).getByText("Theirs")).toBeTruthy();
    expect(within(reviews).getByText("Deleted here, changed elsewhere")).toBeTruthy();
    await userEvent.click(within(reviews).getByRole("button", { name: "Review…" }));
    const dialog = screen.getByRole("dialog", { name: 'Review "Theirs"' });
    expect(within(dialog).getByText("Deleted in this browser")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: /^Restore the other version/ }));

    await vi.waitFor(() => expect(screen.queryByRole("list", { name: "Changes to review" })).toBeNull());
    expect(await getDb().sessions.get(session.id)).toMatchObject({ name: "Theirs", scope: SCOPE, sync: { serverVersion: 5, state: "synced" } });
    expect(await getDb().sessionTombstones.count()).toBe(0);
  });
});
