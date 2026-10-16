import { describe, expect, it } from "vitest";
import {
  deleteSession,
  getSession,
  listSessions,
  putSession,
  SessionNotFoundError,
  updateSession,
  VersionConflictError,
} from "./session-repository";
import { freshDb, sampleSession } from "./test-fixtures";

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

    const renamed = await updateSession(db, session.id, 1, (current) => ({ ...current, name: "Renamed", version: 2 }));
    expect(renamed.version).toBe(2);
    await expect(updateSession(db, session.id, 1, (current) => current)).rejects.toBeInstanceOf(VersionConflictError);
    expect((await getSession(db, session.id))?.name).toBe("Renamed");
  });

  it("reports missing sessions on update and deletes idempotently", async () => {
    const db = freshDb();
    const session = sampleSession();
    await expect(updateSession(db, session.id, 1, (current) => current)).rejects.toBeInstanceOf(SessionNotFoundError);
    await putSession(db, session);
    await deleteSession(db, session.id);
    await deleteSession(db, session.id);
    expect(await getSession(db, session.id)).toBeUndefined();
  });
});
