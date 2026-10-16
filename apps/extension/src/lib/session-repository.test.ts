import { liveQuery } from "dexie";
import { describe, expect, it, vi } from "vitest";
import {
  addSession,
  deleteSession,
  getSession,
  listSessions,
  putSession,
  SessionExistsError,
  SessionNotFoundError,
  updateSession,
  VersionConflictError,
} from "./session-repository";
import { connectAs, freshDb, idFactory, sampleSession, seedAccountSession } from "./test-fixtures";

const context = () => ({ now: new Date("2026-10-16T09:00:00.000Z"), createId: idFactory(9) });

describe("session repository", () => {
  it("persists and lists sessions newest first", async () => {
    const db = freshDb();
    const older = sampleSession({ updatedAt: "2026-10-14T08:00:00.000Z", name: "Older" }, 1);
    const newer = sampleSession({ updatedAt: "2026-10-16T08:00:00.000Z", name: "Newer" }, 2);
    await putSession(db, older);
    await putSession(db, newer);

    expect((await listSessions(db)).map((session) => session.name)).toEqual(["Newer", "Older"]);
    expect(await getSession(db, older.id)).toEqual(older);
  });

  it("survives reopening the database (browser restart)", async () => {
    const db = freshDb();
    const session = sampleSession();
    await putSession(db, session);
    db.close();
    await db.open();
    expect(await getSession(db, session.id)).toEqual(session);
  });

  it("rejects invalid sessions without writing anything", async () => {
    const db = freshDb();
    await expect(putSession(db, { ...sampleSession(), name: "" })).rejects.toThrow();
    expect(await listSessions(db)).toEqual([]);
  });

  it("applies a versioned update and rejects stale versions", async () => {
    const db = freshDb();
    const session = sampleSession();
    await putSession(db, session);

    const renamed = await updateSession(db, session.id, 1, (current) => ({ ...current, name: "Renamed", version: 2 }), context());
    expect(renamed.version).toBe(2);
    await expect(updateSession(db, session.id, 1, (current) => current, context())).rejects.toBeInstanceOf(VersionConflictError);
    expect((await getSession(db, session.id))?.name).toBe("Renamed");
  });

  it("reports missing sessions on update and deletes idempotently", async () => {
    const db = freshDb();
    const session = sampleSession();
    await expect(updateSession(db, session.id, 1, (current) => current, context())).rejects.toBeInstanceOf(SessionNotFoundError);
    await putSession(db, session);
    await deleteSession(db, session.id, context());
    await deleteSession(db, session.id, context());
    expect(await getSession(db, session.id)).toBeUndefined();
  });

  it("addSession inserts but refuses to replace an existing id", async () => {
    const db = freshDb();
    const session = sampleSession();
    await addSession(db, session);
    await expect(addSession(db, { ...session, name: "Replacement" })).rejects.toBeInstanceOf(SessionExistsError);
    expect((await getSession(db, session.id))?.name).toBe(session.name);
  });

  it("keeps a live list updating after a save and when an account connects", async () => {
    const db = freshDb();
    const seen: string[][] = [];
    const subscription = liveQuery(() => listSessions(db)).subscribe({ next: (sessions) => seen.push(sessions.map((session) => session.name)) });
    await vi.waitFor(() => expect(seen.at(-1)).toEqual([]));

    await putSession(db, sampleSession({ name: "Local" }, 1));
    await vi.waitFor(() => expect(seen.at(-1)).toEqual(["Local"]));

    const alice = sampleSession({ name: "Alice's", updatedAt: "2026-10-16T08:30:00.000Z" }, 2);
    await seedAccountSession(db, "AliceAccount00000000000000000000", alice, { serverVersion: 1, state: "synced" });
    await connectAs(db, "AliceAccount00000000000000000000");
    await vi.waitFor(() => expect(seen.at(-1)).toEqual(["Alice's", "Local"]));
    subscription.unsubscribe();
  });
});
