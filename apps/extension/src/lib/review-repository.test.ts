import { describe, expect, it, vi } from "vitest";
import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import type { SavedSession } from "@sessionhub/contracts/session";
import { accountScope } from "./account-scope";
import type { OutboxRecord, SessionHubDb } from "./db";
import { listOutbox } from "./outbox-repository";
import { listReviewItems, resolveReview, ReviewGoneError } from "./review-repository";
import { deleteSession } from "./session-repository";
import { connectAs, freshDb, idFactory, sampleSession, seedAccountSession } from "./test-fixtures";

const ALICE = "AliceAccount00000000000000000000";
const SCOPE = accountScope(ALICE);
const T = new Date("2026-10-16T09:00:00.000Z");
const ids = idFactory(3);
const context = { now: T, createId: ids };

const detail = (session: SavedSession, version: number, name: string): ApiSessionDetail => ({
  id: session.id,
  name,
  description: null,
  workspaceId: null,
  sourceDeviceId: "8c20b166-6156-4728-a9bc-10635ca68ca1",
  sourceDeviceName: "Chrome on Windows",
  isPinned: false,
  isArchived: false,
  version,
  tabCount: 4,
  windowCount: 2,
  createdAt: session.createdAt,
  updatedAt: "2026-10-16T08:30:00.000Z",
  windows: session.windows,
});

interface Case {
  action?: "upsert" | "delete";
  status?: "conflict" | "rejected";
  code?: string;
  copy?: { action: "upsert" | "delete"; version: number } | null;
  conflictServerVersion?: number | null;
}

/** A session of Alice's whose operation the server refused, as the uploader and pull leave it. */
const refused = async ({ action = "upsert", status = "conflict", code = "VERSION_CONFLICT", copy = { action: "upsert", version: 5 }, conflictServerVersion = 5 }: Case = {}) => {
  const db = freshDb();
  await connectAs(db, ALICE);
  const session = sampleSession({ name: "Mine" }, 2);
  if (action === "upsert") await seedAccountSession(db, ALICE, session, { serverVersion: 3, state: status === "conflict" ? "conflict" : "error" });
  else await db.sessionTombstones.put({ id: session.id, scope: SCOPE, deletedAt: T.toISOString() });
  const operation = { id: ids(), scope: SCOPE, entityType: "savedSession", entityId: session.id, expectedVersion: 3, status, createdAt: T.toISOString(), updatedAt: T.toISOString(), attempts: 1, nextAttemptAt: null, lastError: "The server said no", lastErrorCode: code, conflictServerVersion };
  await db.outbox.add({ ...operation, ...(action === "upsert" ? { action, payload: session } : { action, payload: null }) } as OutboxRecord);
  if (copy) await db.serverCopies.put({ id: session.id, scope: SCOPE, action: copy.action, version: copy.version, payload: copy.action === "upsert" ? detail(session, copy.version, "Theirs") : null, receivedAt: T.toISOString() });
  return { db, session };
};

const state = async (db: SessionHubDb, id: string) => ({
  record: await db.sessions.get(id),
  operations: (await listOutbox(db, SCOPE)).map(({ entityId, action, expectedVersion, status }) => ({ entityId, action, expectedVersion, status })),
  copy: await db.serverCopies.get(id),
  tombstone: await db.sessionTombstones.get(id),
});

describe("review items", () => {
  it("lists a refused change with both sides and what can be done, only for the connected account", async () => {
    const { db, session } = await refused();
    const [item, ...rest] = await listReviewItems(db);
    expect(rest).toEqual([]);
    expect(item).toMatchObject({ sessionId: session.id, kind: "edit-conflict", choices: ["keep-mine", "keep-server", "save-both"], local: { name: "Mine" }, server: { name: "Theirs", version: 5 }, serverDeleted: false, message: "The server said no" });
    await connectAs(db, "BobAccount0000000000000000000000");
    expect(await listReviewItems(db)).toEqual([]);
  });
});

describe("resolving an edit conflict", () => {
  it("keep mine: replaces every queued change with one upload on top of the server's version", async () => {
    const { db, session } = await refused();
    await db.outbox.add({ ...(await db.outbox.toArray())[0]!, seq: undefined, id: ids(), status: "queued", expectedVersion: 4 });
    expect(await resolveReview(db, session.id, "keep-mine", context)).toEqual({ sessionId: session.id });
    const after = await state(db, session.id);
    expect(after.operations).toEqual([{ entityId: session.id, action: "upsert", expectedVersion: 5, status: "queued" }]);
    expect(after.record).toMatchObject({ name: "Mine", sync: { serverVersion: 5, state: "pending" } });
    expect(after.copy).toBeUndefined();
  });

  it("keep the server's: takes its version and drops this browser's change", async () => {
    const { db, session } = await refused();
    await resolveReview(db, session.id, "keep-server", context);
    const after = await state(db, session.id);
    expect(after.record).toMatchObject({ name: "Theirs", sourceDeviceName: "Chrome on Windows", sync: { serverVersion: 5, state: "synced" } });
    expect(after.operations).toEqual([]);
    expect(after.copy).toBeUndefined();
  });

  it("keep both: the server's stays under this id, this browser's becomes a new session that uploads", async () => {
    const { db, session } = await refused();
    const { sessionId } = await resolveReview(db, session.id, "save-both", context);
    expect(sessionId).not.toBe(session.id);
    expect((await db.sessions.get(session.id))?.name).toBe("Theirs");
    expect(await db.sessions.get(sessionId)).toMatchObject({ name: "Mine (this browser's version)", version: 1, scope: SCOPE, sync: { serverVersion: null, state: "pending" } });
    expect((await state(db, sessionId)).operations).toEqual([{ entityId: sessionId, action: "upsert", expectedVersion: 0, status: "queued" }]);
  });

  it("offers fewer choices until the server's version arrives, and refuses the rest", async () => {
    const { db, session } = await refused({ copy: null, conflictServerVersion: null });
    expect((await listReviewItems(db))[0]?.choices).toEqual([]);
    await expect(resolveReview(db, session.id, "keep-server", context)).rejects.toBeInstanceOf(ReviewGoneError);
    expect((await state(db, session.id)).operations).toHaveLength(1);
  });
});

describe("resolving the other situations", () => {
  it("deleted on the server: keep mine uploads it as a new session; the other choice deletes it here too", async () => {
    const kept = await refused({ status: "rejected", code: "NOT_FOUND", copy: { action: "delete", version: 4 } });
    const { sessionId } = await resolveReview(kept.db, kept.session.id, "keep-mine", context);
    expect(await kept.db.sessions.get(kept.session.id)).toBeUndefined();
    expect(await kept.db.sessions.get(sessionId)).toMatchObject({ name: "Mine", scope: SCOPE });
    expect((await state(kept.db, sessionId)).operations).toEqual([{ entityId: sessionId, action: "upsert", expectedVersion: 0, status: "queued" }]);

    const dropped = await refused({ status: "rejected", code: "NOT_FOUND", copy: null });
    await resolveReview(dropped.db, dropped.session.id, "keep-server", context);
    expect(await state(dropped.db, dropped.session.id)).toMatchObject({ record: undefined, operations: [] });
  });

  it("deleted here but edited elsewhere: restore the server's version, or delete it everywhere", async () => {
    const restored = await refused({ action: "delete" });
    await resolveReview(restored.db, restored.session.id, "keep-server", context);
    expect(await state(restored.db, restored.session.id)).toMatchObject({ record: { name: "Theirs", sync: { state: "synced" } }, operations: [], tombstone: undefined });

    const deleted = await refused({ action: "delete" });
    await resolveReview(deleted.db, deleted.session.id, "keep-mine", context);
    const after = await state(deleted.db, deleted.session.id);
    expect(after.operations).toEqual([{ entityId: deleted.session.id, action: "delete", expectedVersion: 5, status: "queued" }]);
    expect(after.tombstone).toBeDefined();
    expect(after.record).toBeUndefined();
  });

  it("an id taken on the server, or a session the server can't accept, can go back to this browser only", async () => {
    for (const code of ["ID_IN_USE", "TOO_LARGE"]) {
      const { db, session } = await refused({ status: "rejected", code, copy: null });
      await resolveReview(db, session.id, "local-only", context);
      const after = await state(db, session.id);
      expect(after.record).toEqual({ ...session, scope: "local" });
      expect(after.operations).toEqual([]);
    }
  });

  it("an id taken by another session of the account keeps that session under the id, whichever choice", async () => {
    for (const choice of ["keep-mine", "local-only"] as const) {
      const { db, session } = await refused({ status: "rejected", code: "ID_IN_USE", copy: { action: "upsert", version: 1 } });
      const { sessionId } = await resolveReview(db, session.id, choice, context);
      // The pull already passed the account's session, so dropping its copy would hide it here for good.
      expect(await state(db, session.id)).toMatchObject({ record: { name: "Theirs", scope: SCOPE, sync: { serverVersion: 1, state: "synced" } }, copy: undefined });
      expect(sessionId).not.toBe(session.id);
      expect(await db.sessions.get(sessionId)).toMatchObject({ name: "Mine", scope: choice === "keep-mine" ? SCOPE : "local" });
      const created = choice === "keep-mine" ? [{ entityId: sessionId, action: "upsert", expectedVersion: 0, status: "queued" }] : [];
      expect((await state(db, sessionId)).operations).toEqual(created);
    }
  });

  it("a session deleted here after its upload was refused can drop the change, uploading nothing", async () => {
    for (const code of ["ID_IN_USE", "TOO_LARGE", "VALIDATION_ERROR"]) {
      const { db, session } = await refused({ status: "rejected", code, copy: null });
      await deleteSession(db, session.id, context);
      const [item] = await listReviewItems(db);
      expect(item?.choices).toEqual(["keep-server"]);
      await resolveReview(db, session.id, "keep-server", context);
      // The refused upload, the delete queued behind it and the tombstone all go; nothing is sent.
      expect(await state(db, session.id)).toEqual({ record: undefined, operations: [], copy: undefined, tombstone: undefined });
      expect(await listReviewItems(db)).toEqual([]);
    }
  });

  it("dropping the change of a session deleted here keeps the account's session that holds its id", async () => {
    const { db, session } = await refused({ status: "rejected", code: "ID_IN_USE", copy: { action: "upsert", version: 1 } });
    await deleteSession(db, session.id, context);
    await resolveReview(db, session.id, "keep-server", context);
    expect(await state(db, session.id)).toMatchObject({ record: { name: "Theirs", sync: { state: "synced" } }, operations: [], copy: undefined, tombstone: undefined });
  });
});

describe("resolving safely", () => {
  it("refuses a second resolution of the same change", async () => {
    const { db, session } = await refused();
    await resolveReview(db, session.id, "keep-server", context);
    await expect(resolveReview(db, session.id, "keep-mine", context)).rejects.toThrow("already resolved");
  });

  it("is all or nothing: a failed write keeps the change, the server copy and the session as they were", async () => {
    const { db, session } = await refused();
    const before = await state(db, session.id);
    const add = vi.spyOn(db.sessions, "add").mockRejectedValueOnce(new Error("disk failure"));
    await expect(resolveReview(db, session.id, "save-both", context)).rejects.toThrow("disk failure");
    add.mockRestore();
    expect(await state(db, session.id)).toEqual(before);
  });
});
