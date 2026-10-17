import { describe, expect, it, vi } from "vitest";
import { renameSession } from "@sessionhub/core/session-edit";
import { accountScope } from "./account-scope";
import type { AccountDeps } from "./account-service";
import { updateSession } from "./session-repository";
import type { SyncDeps } from "./sync-gate";
import { syncNow } from "./sync-runner";
import { connectAs, freshDb, idFactory, sampleSession, seedAccountSession } from "./test-fixtures";

const ALICE = "AliceAccount00000000000000000000";
const T0 = new Date("2026-10-16T08:00:00.000Z");
const ids = idFactory(8);
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const EMPTY_CURSOR = "c1.0.AAAAAAAAAAAAAAAAAAAAAA";

describe("syncNow", () => {
  it("gives a change made during a run its own run right after, shared by everyone who asked meanwhile", async () => {
    const db = freshDb();
    await connectAs(db, ALICE);
    await db.syncState.put({ scope: accountScope(ALICE), enabledAt: T0.toISOString(), cursor: EMPTY_CURSOR, lastSyncAt: null, lastError: null, failures: 0, nextAttemptAt: null });
    const session = sampleSession({ name: "First" }, 2);
    await seedAccountSession(db, ALICE, session, { serverVersion: 1, state: "synced" });
    const rename = (version: number, name: string) => updateSession(db, session.id, version, (current) => renameSession(current, name, T0), { now: T0, createId: ids });
    await rename(1, "Second");

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pushed: string[][] = [];
    let pulls = 0;
    const fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/sync/pull") {
        // The first run's download waits here: its upload has already finished.
        if ((pulls += 1) === 1) await gate;
        return json({ protocolVersion: 1, cursor: EMPTY_CURSOR, nextCursor: EMPTY_CURSOR, hasMore: false, changes: [] });
      }
      const body = JSON.parse(String(init?.body)) as { operations: { clientOperationId: string; entityId: string; expectedVersion: number; payload: { name: string } }[] };
      pushed.push(body.operations.map((op) => op.payload.name));
      return json({ protocolVersion: 1, results: body.operations.map((op) => ({ status: "accepted", clientOperationId: op.clientOperationId, entityId: op.entityId, serverVersion: op.expectedVersion + 1, serverSequence: "1", replayed: false })) });
    });
    const account: AccountDeps = { db, fetch: fetch as unknown as typeof globalThis.fetch, now: () => T0, createId: ids, apiOrigin: "https://sessionhub.example", openTab: async () => undefined, platformOs: async () => "mac" };
    const deps: SyncDeps = { db, now: () => T0, random: () => 1, account, scheduleRetry: async () => undefined };

    const first = syncNow(deps);
    await vi.waitFor(() => expect(pulls).toBe(1));
    // Renamed after the first run's upload finished, while it downloads: that run can't carry it.
    await rename(2, "Third");
    const second = syncNow(deps);
    const third = syncNow(deps);
    expect(second).toBe(third);
    release();

    expect((await first).push).toMatchObject({ status: "done", accepted: 1 });
    expect((await second).push).toMatchObject({ status: "done", accepted: 1, remaining: 0 });
    expect(pushed).toEqual([["Second"], ["Third"]]);
    expect((await db.sessions.get(session.id))?.sync).toEqual({ serverVersion: 3, state: "synced" });
  });

  it("counts a run as synced only when its download succeeds too, and keeps backing off while it fails", async () => {
    const db = freshDb();
    const scope = accountScope(ALICE);
    const earlier = "2026-10-16T07:30:00.000Z";
    await connectAs(db, ALICE);
    await db.syncState.put({ scope, enabledAt: T0.toISOString(), cursor: EMPTY_CURSOR, lastSyncAt: earlier, lastError: null, failures: 0, nextAttemptAt: null });
    const session = sampleSession({ name: "First" }, 2);
    await seedAccountSession(db, ALICE, session, { serverVersion: 1, state: "synced" });
    await updateSession(db, session.id, 1, (current) => renameSession(current, "Second", T0), { now: T0, createId: ids });

    const clock = { now: T0 };
    let pullWorks = false;
    const fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      if (new URL(String(input)).pathname === "/api/v1/sync/pull") {
        if (!pullWorks) throw new TypeError("fetch failed");
        return json({ protocolVersion: 1, cursor: EMPTY_CURSOR, nextCursor: EMPTY_CURSOR, hasMore: false, changes: [] });
      }
      const body = JSON.parse(String(init?.body)) as { operations: { clientOperationId: string; entityId: string; expectedVersion: number }[] };
      return json({ protocolVersion: 1, results: body.operations.map((op) => ({ status: "accepted", clientOperationId: op.clientOperationId, entityId: op.entityId, serverVersion: op.expectedVersion + 1, serverSequence: "1", replayed: false })) });
    });
    const account: AccountDeps = { db, fetch: fetch as unknown as typeof globalThis.fetch, now: () => clock.now, createId: ids, apiOrigin: "https://sessionhub.example", openTab: async () => undefined, platformOs: async () => "mac" };
    const deps: SyncDeps = { db, now: () => clock.now, random: () => 1, account, scheduleRetry: async () => undefined };

    const first = await syncNow(deps);
    expect(first.push).toMatchObject({ status: "done", accepted: 1 });
    expect(first.pull).toMatchObject({ status: "error", retryAt: "2026-10-16T08:00:05.000Z" });
    expect(await db.syncState.get(scope)).toMatchObject({ lastSyncAt: earlier, failures: 1 });

    // Nothing left to upload (no request), but the download still fails: the wait doubles.
    clock.now = new Date("2026-10-16T08:00:06.000Z");
    expect((await syncNow(deps)).pull).toMatchObject({ status: "error", retryAt: "2026-10-16T08:00:16.000Z" });
    expect(await db.syncState.get(scope)).toMatchObject({ lastSyncAt: earlier, failures: 2 });

    pullWorks = true;
    clock.now = new Date("2026-10-16T08:00:17.000Z");
    expect((await syncNow(deps)).pull).toMatchObject({ status: "done" });
    expect(await db.syncState.get(scope)).toMatchObject({ lastSyncAt: "2026-10-16T08:00:17.000Z", failures: 0, nextAttemptAt: null, lastError: null });
  });
});
