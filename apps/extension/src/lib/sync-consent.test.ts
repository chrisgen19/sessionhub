import { describe, expect, it, vi } from "vitest";
import { createSessionExport } from "@sessionhub/core/session-export";
import { accountScope } from "./account-scope";
import { handleCommand, type HandlerDeps } from "./command-handlers";
import { listOutbox } from "./outbox-repository";
import { putSession } from "./session-repository";
import { disableSync, enableSync, SyncUnavailableError } from "./sync-consent";
import { connectAs, freshDb, idFactory, sampleSession, sampleWindows, seedAccountSession } from "./test-fixtures";

const ALICE = "AliceAccount00000000000000000000";
const SCOPE = accountScope(ALICE);
const T1 = new Date("2026-10-16T08:00:00.000Z");
const T2 = new Date("2026-10-16T09:00:00.000Z");
const ids = idFactory(5);
const at = (now: Date) => ({ now, createId: ids });

describe("turning sync on", () => {
  it("records consent once and moves only the chosen local sessions, each with a queued create", async () => {
    const db = freshDb();
    await connectAs(db, ALICE);
    const [a, b] = [sampleSession({ name: "A" }, 1), sampleSession({ name: "B" }, 2)];
    await putSession(db, a);
    await putSession(db, b);
    const already = sampleSession({ name: "Already in the account" }, 3);
    await seedAccountSession(db, ALICE, already, { serverVersion: 2, state: "synced" });

    expect(await enableSync(db, [a.id, already.id, a.id, ids()], at(T1))).toEqual({ enabledAt: T1.toISOString(), moved: 1 });
    expect(await db.sessions.get(a.id)).toMatchObject({ scope: SCOPE, sync: { serverVersion: null, state: "pending" } });
    expect((await db.sessions.get(b.id))?.scope).toBe("local");
    expect((await db.sessions.get(already.id))?.sync).toEqual({ serverVersion: 2, state: "synced" });
    expect(await listOutbox(db, SCOPE)).toMatchObject([{ entityId: a.id, action: "upsert", expectedVersion: 0, status: "queued" }]);

    // Later, uploading more keeps the original consent time and the pull position.
    await db.syncState.update(SCOPE, { cursor: "c1.7.AAAAAAAAAAAAAAAAAAAAAA" });
    expect(await enableSync(db, [b.id], at(T2))).toEqual({ enabledAt: T1.toISOString(), moved: 1 });
    expect(await db.syncState.get(SCOPE)).toMatchObject({ enabledAt: T1.toISOString(), cursor: "c1.7.AAAAAAAAAAAAAAAAAAAAAA", failures: 0 });
  });

  it("needs a connection that knows its account", async () => {
    const db = freshDb();
    await expect(enableSync(db, [], at(T1))).rejects.toBeInstanceOf(SyncUnavailableError);
    await connectAs(db, null);
    await expect(enableSync(db, [], at(T1))).rejects.toBeInstanceOf(SyncUnavailableError);
    expect(await db.syncState.count()).toBe(0);
  });

  it("is all or nothing: a failed write records no consent and moves nothing", async () => {
    const db = freshDb();
    await connectAs(db, ALICE);
    const a = sampleSession({}, 1);
    await putSession(db, a);
    const add = vi.spyOn(db.outbox, "add").mockRejectedValueOnce(new Error("disk failure"));
    await expect(enableSync(db, [a.id], at(T1))).rejects.toThrow("disk failure");
    add.mockRestore();
    expect((await db.sessions.get(a.id))?.scope).toBe("local");
    expect(await db.syncState.get(SCOPE)).toBeUndefined();
  });

  it("turning it off keeps every session and queued change", async () => {
    const db = freshDb();
    await connectAs(db, ALICE);
    const a = sampleSession({}, 1);
    await putSession(db, a);
    await enableSync(db, [a.id], at(T1));
    await disableSync(db);
    expect((await db.syncState.get(SCOPE))?.enabledAt).toBeNull();
    expect((await db.sessions.get(a.id))?.scope).toBe(SCOPE);
    expect(await db.outbox.count()).toBe(1);
  });
});

describe("where new saves go", () => {
  it("into the account while sync is on (uploads queued), into this browser otherwise", async () => {
    const db = freshDb();
    await connectAs(db, ALICE);
    const deps: HandlerDeps = { db, readWindows: async () => sampleWindows(), restoreWindow: async () => [], now: () => T1, createId: ids };
    const capture = async () => {
      const response = await handleCommand({ type: "session.capture", scope: { kind: "all-windows" } }, deps);
      if (!response.ok) throw new Error(response.error.message);
      return response.data as { sessionId: string; syncing: boolean };
    };

    const before = await capture();
    expect(before.syncing).toBe(false);
    expect((await db.sessions.get(before.sessionId))?.scope).toBe("local");

    expect(await handleCommand({ type: "sync.enable", sessionIds: [] }, deps)).toEqual({ ok: true, data: { enabledAt: T1.toISOString(), moved: 0 } });
    const during = await capture();
    expect(during.syncing).toBe(true);
    expect(await db.sessions.get(during.sessionId)).toMatchObject({ scope: SCOPE, sync: { serverVersion: null, state: "pending" } });
    const imported = await handleCommand({ type: "session.import", content: JSON.stringify(createSessionExport(sampleSession(), T1)) }, deps);
    expect(imported).toMatchObject({ ok: true, data: { syncing: true } });
    expect((await listOutbox(db, SCOPE)).map((operation) => operation.expectedVersion)).toEqual([0, 0]);

    expect(await handleCommand({ type: "sync.disable" }, deps)).toEqual({ ok: true, data: {} });
    expect((await capture()).syncing).toBe(false);
  });

  it("keeps a checkpoint as an account session while sync is on, queued like any save", async () => {
    const db = freshDb();
    await connectAs(db, ALICE);
    const deps: HandlerDeps = { db, readWindows: async () => sampleWindows(), restoreWindow: async () => [], now: () => T1, createId: ids };
    await handleCommand({ type: "sync.enable", sessionIds: [] }, deps);
    const checkpoint = await handleCommand({ type: "recovery.checkpointNow" }, deps);
    const snapshotId = checkpoint.ok ? (checkpoint.data as { snapshotId: string }).snapshotId : "";

    const saved = await handleCommand({ type: "recovery.saveAsSession", snapshotId }, deps);
    expect(saved).toMatchObject({ ok: true, data: { syncing: true } });
    const sessionId = saved.ok ? (saved.data as { sessionId: string }).sessionId : "";
    expect(await db.sessions.get(sessionId)).toMatchObject({ scope: SCOPE, sync: { serverVersion: null, state: "pending" } });
    expect((await listOutbox(db, SCOPE)).map((operation) => operation.expectedVersion)).toEqual([0]);
  });
});
