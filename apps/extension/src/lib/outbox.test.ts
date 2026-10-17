import { describe, expect, it, vi } from "vitest";
import { renameSession } from "@sessionhub/core/session-edit";
import type { SavedSession } from "@sessionhub/contracts/session";
import { accountScope } from "./account-scope";
import { handleCommand, type HandlerDeps } from "./command-handlers";
import { createDb, type SessionHubDb } from "./db";
import { listOutbox } from "./outbox-repository";
import { deleteSession, getSession, listSessions, putSession, SessionNotFoundError, updateSession } from "./session-repository";
import { connectAs, freshDb, idFactory, sampleSession, sampleWindows, seedAccountSession } from "./test-fixtures";

const ALICE = "AliceAccount00000000000000000000";
const BOB = "BobAccount0000000000000000000000";
const T = new Date("2026-10-16T09:00:00.000Z");

// One id source for the whole file: operation ids must be unique, like crypto.randomUUID().
const ids = idFactory(9);
const context = () => ({ now: T, createId: ids });

/** Renames through the repository the way the `session.rename` command does. */
const rename = async (db: SessionHubDb, id: string, name: string) => {
  const current = await getSession(db, id);
  if (!current) throw new Error("missing");
  return updateSession(db, id, current.version, (session) => renameSession(session, name, T), context());
};

const markSending = async (db: SessionHubDb, accountId: string) => {
  for (const operation of await listOutbox(db, accountScope(accountId))) await db.outbox.put({ ...operation, status: "sending" });
};

const aliceSession = async (db: SessionHubDb, serverVersion: number | null, overrides: Partial<SavedSession> = {}, prefix = 2) => {
  const session = sampleSession({ name: "Alice's research", updatedAt: "2026-10-16T08:30:00.000Z", ...overrides }, prefix);
  await seedAccountSession(db, ALICE, session, { serverVersion, state: serverVersion === null ? "pending" : "synced" });
  return session;
};

describe("account scope", () => {
  it("shows this browser's sessions always, and an account's only while connected to it", async () => {
    const db = freshDb();
    const local = sampleSession({ name: "Local" }, 1);
    await putSession(db, local);
    const alice = await aliceSession(db, 3);

    expect((await listSessions(db)).map((session) => session.name)).toEqual(["Local"]);
    expect(await getSession(db, alice.id)).toBeUndefined();

    await connectAs(db, ALICE);
    expect((await listSessions(db)).map((session) => session.name)).toEqual(["Alice's research", "Local"]);
    expect(await getSession(db, alice.id)).toEqual(alice);

    await connectAs(db, BOB);
    expect((await listSessions(db)).map((session) => session.name)).toEqual(["Local"]);
    await connectAs(db, null);
    expect((await listSessions(db)).map((session) => session.name)).toEqual(["Local"]);
  });

  it("never edits or deletes another account's hidden session", async () => {
    const db = freshDb();
    const alice = await aliceSession(db, 3);
    await connectAs(db, BOB);

    await expect(updateSession(db, alice.id, 1, (session) => renameSession(session, "Taken over", T), context())).rejects.toBeInstanceOf(SessionNotFoundError);
    await deleteSession(db, alice.id, context());

    expect(await db.sessions.get(alice.id)).toMatchObject({ name: "Alice's research", scope: accountScope(ALICE), sync: { serverVersion: 3, state: "synced" } });
    expect(await db.outbox.count()).toBe(0);
    expect(await db.sessionTombstones.count()).toBe(0);
  });

  it("keeps each account's queued changes apart, and keeps them while disconnected", async () => {
    const db = freshDb();
    const alice = await aliceSession(db, 3);
    await connectAs(db, ALICE);
    await rename(db, alice.id, "Renamed by Alice");

    await connectAs(db, BOB);
    expect(await listOutbox(db, accountScope(BOB))).toEqual([]);
    await db.account.delete("connection");
    expect(await listOutbox(db, accountScope(ALICE))).toHaveLength(1);

    await connectAs(db, ALICE);
    expect((await getSession(db, alice.id))?.name).toBe("Renamed by Alice");
  });
});

describe("outbox", () => {
  it("never queues anything for this browser's own sessions", async () => {
    const db = freshDb();
    await connectAs(db, ALICE);
    const local = sampleSession({}, 1);
    await putSession(db, local);
    await rename(db, local.id, "Still local");
    await deleteSession(db, local.id, context());
    expect(await db.outbox.count()).toBe(0);
    expect(await db.sessionTombstones.count()).toBe(0);
  });

  it("queues one upload on the server version and merges edits into it until it is sent", async () => {
    const db = freshDb();
    const alice = await aliceSession(db, 3);
    await connectAs(db, ALICE);

    await rename(db, alice.id, "First");
    await rename(db, alice.id, "Second");
    const [merged, ...rest] = await listOutbox(db, accountScope(ALICE));
    expect(rest).toEqual([]);
    expect(merged).toMatchObject({ action: "upsert", entityId: alice.id, expectedVersion: 3, status: "queued", payload: { name: "Second", version: 3 } });
    expect(await db.sessions.get(alice.id)).toMatchObject({ name: "Second", version: 3, sync: { serverVersion: 3, state: "pending" } });

    await markSending(db, ALICE);
    await rename(db, alice.id, "Third");
    const operations = await listOutbox(db, accountScope(ALICE));
    expect(operations.map(({ expectedVersion, status, payload }) => ({ expectedVersion, status, name: payload?.name }))).toEqual([
      { expectedVersion: 3, status: "sending", name: "Second" },
      { expectedVersion: 4, status: "queued", name: "Third" },
    ]);
    expect(operations[0]!.id).toBe(merged!.id);
    expect(operations[1]!.id).not.toBe(merged!.id);
  });

  it("uploads a session the server has never seen as a create (version 0)", async () => {
    const db = freshDb();
    const alice = await aliceSession(db, null);
    await connectAs(db, ALICE);
    await rename(db, alice.id, "New on this browser");
    expect(await listOutbox(db, accountScope(ALICE))).toMatchObject([{ action: "upsert", expectedVersion: 0 }]);
  });

  it("keeps a conflict visible when the session is edited again", async () => {
    const db = freshDb();
    const alice = await aliceSession(db, 3);
    await db.sessions.update(alice.id, { sync: { serverVersion: 3, state: "conflict" } });
    await connectAs(db, ALICE);
    await rename(db, alice.id, "Edited during conflict");
    expect((await db.sessions.get(alice.id))?.sync).toEqual({ serverVersion: 3, state: "conflict" });
  });

  it("turns a queued edit into a delete and leaves a tombstone", async () => {
    const db = freshDb();
    const alice = await aliceSession(db, 3);
    await connectAs(db, ALICE);
    await rename(db, alice.id, "Edited, then deleted");
    const [edit] = await listOutbox(db, accountScope(ALICE));

    await deleteSession(db, alice.id, context());
    expect(await listOutbox(db, accountScope(ALICE))).toMatchObject([{ id: edit!.id, action: "delete", expectedVersion: 3, payload: null }]);
    expect(await db.sessionTombstones.get(alice.id)).toEqual({ id: alice.id, scope: accountScope(ALICE), deletedAt: T.toISOString() });
    expect(await db.sessions.get(alice.id)).toBeUndefined();
  });

  it("uploads nothing for a session deleted before its create was sent", async () => {
    const db = freshDb();
    const alice = await aliceSession(db, null);
    await connectAs(db, ALICE);
    await rename(db, alice.id, "Short-lived");
    await deleteSession(db, alice.id, context());
    expect(await db.outbox.count()).toBe(0);
    expect(await db.sessionTombstones.count()).toBe(0);
    expect(await db.sessions.get(alice.id)).toBeUndefined();
  });

  it("queues a delete after a create that was already sent", async () => {
    const db = freshDb();
    const alice = await aliceSession(db, null);
    await connectAs(db, ALICE);
    await rename(db, alice.id, "Sent");
    await markSending(db, ALICE);
    await deleteSession(db, alice.id, context());
    expect((await listOutbox(db, accountScope(ALICE))).map(({ action, expectedVersion, status }) => ({ action, expectedVersion, status }))).toEqual([
      { action: "upsert", expectedVersion: 0, status: "sending" },
      { action: "delete", expectedVersion: 1, status: "queued" },
    ]);
    expect(await db.sessionTombstones.get(alice.id)).toBeDefined();
  });

  it("writes an edit and its operation together or not at all", async () => {
    const db = freshDb();
    const alice = await aliceSession(db, 3);
    await connectAs(db, ALICE);
    const put = vi.spyOn(db.sessions, "put").mockRejectedValueOnce(new Error("disk failure"));

    await expect(rename(db, alice.id, "Lost")).rejects.toThrow("disk failure");
    put.mockRestore();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.sessions.get(alice.id)).toMatchObject({ name: "Alice's research", version: 1, sync: { serverVersion: 3, state: "synced" } });
  });

  it("writes a delete, its operation and its tombstone together or not at all", async () => {
    const db = freshDb();
    const alice = await aliceSession(db, 3);
    await connectAs(db, ALICE);
    const remove = vi.spyOn(db.sessions, "delete").mockRejectedValueOnce(new Error("disk failure"));

    await expect(deleteSession(db, alice.id, context())).rejects.toThrow("disk failure");
    remove.mockRestore();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.sessionTombstones.count()).toBe(0);
    expect(await getSession(db, alice.id)).toEqual(alice);
  });

  it("keeps queued operations across a restart (the database is reopened)", async () => {
    const db = freshDb();
    const alice = await aliceSession(db, 3);
    await connectAs(db, ALICE);
    await rename(db, alice.id, "Before restart");
    const before = await listOutbox(db, accountScope(ALICE));
    db.close();

    const reopened = createDb(db.name);
    expect(await listOutbox(reopened, accountScope(ALICE))).toEqual(before);
    expect((await reopened.sessions.get(alice.id))?.sync).toEqual({ serverVersion: 3, state: "pending" });
  });

  it("lists operations in the order they were first queued", async () => {
    const db = freshDb();
    const first = await aliceSession(db, 1, { name: "One" }, 2);
    const second = await aliceSession(db, 1, { name: "Two" }, 3);
    await connectAs(db, ALICE);
    await rename(db, second.id, "Two edited");
    await rename(db, first.id, "One edited");
    await rename(db, second.id, "Two edited again");
    expect((await listOutbox(db, accountScope(ALICE))).map((operation) => operation.payload?.name)).toEqual(["Two edited again", "One edited"]);
  });

  it("queues operations from the worker's rename and delete commands", async () => {
    const db = freshDb();
    const alice = await aliceSession(db, 3);
    await connectAs(db, ALICE);
    const deps: HandlerDeps = { db, readWindows: async () => sampleWindows(), restoreWindow: async () => [], now: () => T, createId: idFactory(8) };

    expect(await handleCommand({ type: "session.rename", sessionId: alice.id, expectedVersion: 1, name: "Via command" }, deps)).toEqual({ ok: true, data: { version: 2 } });
    expect(await handleCommand({ type: "session.delete", sessionId: alice.id }, deps)).toEqual({ ok: true, data: {} });
    expect(await listOutbox(db, accountScope(ALICE))).toMatchObject([{ action: "delete", expectedVersion: 3 }]);
  });
});
