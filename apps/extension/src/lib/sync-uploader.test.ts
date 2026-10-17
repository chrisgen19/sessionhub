import { describe, expect, it, vi } from "vitest";
import { renameSession } from "@sessionhub/core/session-edit";
import type { SavedSession } from "@sessionhub/contracts/session";
import { accountScope } from "./account-scope";
import type { AccountDeps } from "./account-service";
import { handleCommand } from "./command-handlers";
import type { SessionHubDb } from "./db";
import { listOutbox } from "./outbox-repository";
import { deleteSession, getSession, updateSession } from "./session-repository";
import { toSyncPayload } from "./sync-batch";
import { syncNow } from "./sync-runner";
import { pushNow } from "./sync-uploader";
import type { SyncDeps } from "./sync-gate";
import { connectAs, freshDb, idFactory, sampleSession, sampleWindows, seedAccountSession } from "./test-fixtures";

const ALICE = "AliceAccount00000000000000000000";
const SCOPE = accountScope(ALICE);
const T0 = new Date("2026-10-16T08:00:00.000Z");
const ids = idFactory(6);

type PushBody = { protocolVersion: number; deviceId: string; operations: { clientOperationId: string; entityId: string; action: string; expectedVersion: number; payload: unknown }[] };
type Handler = (body: PushBody, db: SessionHubDb) => Response | Promise<Response>;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const results = (body: PushBody, result: (op: PushBody["operations"][number]) => object) => json(200, { protocolVersion: 1, results: body.operations.map(result) });
const acceptAll: Handler = (body) =>
  results(body, (op) => ({ status: "accepted", clientOperationId: op.clientOperationId, entityId: op.entityId, serverVersion: op.expectedVersion + 1, serverSequence: "9", replayed: false }));

/** A connected, sync-enabled browser whose server answers pushes with the queued handlers (last repeats). */
const setup = async (...handlers: Handler[]) => {
  const db = freshDb();
  const clock = { now: T0 };
  const calls: { body: PushBody; authorization: string | null }[] = [];
  const fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    // An empty account to download, for runs that also pull (sync.now).
    if (path === "/api/v1/sync/bootstrap") return json(200, { protocolVersion: 1, cursor: "c1.0.AAAAAAAAAAAAAAAAAAAAAA", nextAfter: null, hasMore: false, items: [] });
    if (path === "/api/v1/sync/pull") return json(200, { protocolVersion: 1, cursor: "c1.0.AAAAAAAAAAAAAAAAAAAAAA", nextCursor: "c1.0.AAAAAAAAAAAAAAAAAAAAAA", hasMore: false, changes: [] });
    if (path !== "/api/v1/sync/push") throw new TypeError("fetch failed");
    const body = JSON.parse(String(init?.body)) as PushBody;
    calls.push({ body, authorization: new Headers(init?.headers).get("authorization") });
    const handler = handlers.length > 1 ? handlers.shift()! : handlers[0]!;
    return handler(body, db);
  });
  const account: AccountDeps = { db, fetch: fetch as unknown as typeof globalThis.fetch, now: () => clock.now, createId: ids, apiOrigin: "https://sessionhub.example", openTab: async () => undefined, platformOs: async () => "mac" };
  const scheduleRetry = vi.fn(async (_at: Date) => undefined);
  const deps: SyncDeps = { db, now: () => clock.now, random: () => 1, account, scheduleRetry };
  await connectAs(db, ALICE);
  await db.syncState.put({ scope: SCOPE, enabledAt: T0.toISOString(), cursor: null, lastSyncAt: null, lastError: null, failures: 0, nextAttemptAt: null });
  return { db, deps, calls, clock, scheduleRetry, fetch };
};

/** An account session with one queued edit (or a create when serverVersion is null). */
const queuedEdit = async (db: SessionHubDb, serverVersion: number | null, name = "Edited", prefix = 2): Promise<SavedSession> => {
  const session = sampleSession({ name: `Session ${prefix}` }, prefix);
  await seedAccountSession(db, ALICE, session, { serverVersion, state: serverVersion === null ? "pending" : "synced" });
  return updateSession(db, session.id, session.version, (current) => renameSession(current, name, T0), { now: T0, createId: ids });
};

describe("sync uploader", () => {
  it("uploads nothing while disconnected or before sync was turned on for the account", async () => {
    const { db, deps, fetch } = await setup(acceptAll);
    await queuedEdit(db, 1);
    await db.syncState.update(SCOPE, { enabledAt: null });
    expect(await pushNow(deps)).toEqual({ status: "disabled" });
    await db.account.delete("connection");
    expect(await pushNow(deps)).toEqual({ status: "disconnected" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("commits `sending` before the request, then settles the session as synced", async () => {
    let duringRequest: unknown;
    const { db, deps, calls } = await setup(async (body, database) => {
      duringRequest = (await database.outbox.toArray()).map(({ status, attempts }) => ({ status, attempts }));
      return acceptAll(body, database);
    });
    const session = await queuedEdit(db, null, "New on this browser");
    const [operation] = await listOutbox(db, SCOPE);

    expect(await pushNow(deps)).toEqual({ status: "done", accepted: 1, conflicts: 0, rejected: 0, remaining: 0 });
    expect(duringRequest).toEqual([{ status: "sending", attempts: 1 }]);
    expect(calls[0]).toEqual({
      authorization: "Bearer shd_at_test",
      body: {
        protocolVersion: 1,
        deviceId: "6f1c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f",
        operations: [{ clientOperationId: operation!.id, entityType: "savedSession", entityId: session.id, action: "upsert", expectedVersion: 0, payload: toSyncPayload(session) }],
      },
    });
    expect(await db.outbox.count()).toBe(0);
    expect((await db.sessions.get(session.id))?.sync).toEqual({ serverVersion: 1, state: "synced" });
    // The pull that follows in a sync run records it (sync-runner); the upload alone doesn't.
    expect(await db.syncState.get(SCOPE)).toMatchObject({ failures: 0, lastError: null, lastSyncAt: null });
  });

  it("sends one operation per session per push and holds a session back after a conflict", async () => {
    const { db, deps, calls } = await setup((body) =>
      results(body, (op) =>
        op.expectedVersion === 3
          ? { status: "conflict", clientOperationId: op.clientOperationId, entityId: op.entityId, code: "VERSION_CONFLICT", expectedVersion: 3, serverVersion: 4, message: "Changed elsewhere", replayed: false }
          : { status: "accepted", clientOperationId: op.clientOperationId, entityId: op.entityId, serverVersion: op.expectedVersion + 1, serverSequence: "5", replayed: false },
      ),
    );
    const a = await queuedEdit(db, 3, "A first", 2);
    for (const operation of await listOutbox(db, SCOPE)) await db.outbox.put({ ...operation, status: "sending" });
    await updateSession(db, a.id, a.version, (current) => renameSession(current, "A second", T0), { now: T0, createId: ids });
    const b = await queuedEdit(db, 1, "B", 3);

    expect(await pushNow(deps)).toEqual({ status: "done", accepted: 1, conflicts: 1, rejected: 0, remaining: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.operations.map((op) => [op.entityId, op.expectedVersion])).toEqual([[a.id, 3], [b.id, 1]]);
    expect((await listOutbox(db, SCOPE)).map(({ entityId, status, expectedVersion, lastError }) => ({ entityId, status, expectedVersion, lastError }))).toEqual([
      { entityId: a.id, status: "conflict", expectedVersion: 3, lastError: "Changed elsewhere" },
      { entityId: a.id, status: "queued", expectedVersion: 4, lastError: null },
    ]);
    expect((await db.sessions.get(a.id))?.sync?.state).toBe("conflict");
    expect((await db.sessions.get(b.id))?.sync).toEqual({ serverVersion: 2, state: "synced" });
  });

  it("backs off after a network failure, then resends the very same operation", async () => {
    const { db, deps, calls, clock, scheduleRetry } = await setup(() => {
      throw new TypeError("fetch failed");
    }, acceptAll);
    await queuedEdit(db, 2);

    expect(await pushNow(deps)).toMatchObject({ status: "error", retryAt: "2026-10-16T08:00:05.000Z" });
    expect(scheduleRetry).toHaveBeenCalledWith(new Date("2026-10-16T08:00:05.000Z"));
    expect(await db.syncState.get(SCOPE)).toMatchObject({ failures: 1, nextAttemptAt: "2026-10-16T08:00:05.000Z" });
    expect(await listOutbox(db, SCOPE)).toMatchObject([{ status: "sending", attempts: 1 }]);
    expect(await pushNow(deps)).toEqual({ status: "waiting", retryAt: "2026-10-16T08:00:05.000Z" });

    clock.now = new Date("2026-10-16T08:00:06.000Z");
    expect((await syncNow(deps)).push).toMatchObject({ status: "done", accepted: 1 });
    expect(calls[1]!.body.operations).toEqual(calls[0]!.body.operations);
    // A whole run (upload, then download) succeeded, so the backoff ends.
    expect(await db.syncState.get(SCOPE)).toMatchObject({ failures: 0, nextAttemptAt: null });
  });

  it("stops when another account connects mid-run, so nothing is sent with its token", async () => {
    const { db, deps, calls } = await setup(async (body, db) => {
      // The first round is in flight when the user disconnects and pairs Bob's account.
      await connectAs(db, "BobAccount0000000000000000000000", "shd_at_bob");
      return acceptAll(body, db);
    });
    const a = await queuedEdit(db, 3, "A first", 2);
    for (const operation of await listOutbox(db, SCOPE)) await db.outbox.put({ ...operation, status: "sending" });
    await updateSession(db, a.id, a.version, (current) => renameSession(current, "A second", T0), { now: T0, createId: ids });

    expect(await pushNow(deps)).toEqual({ status: "disconnected" });
    expect(calls.map((call) => call.authorization)).toEqual(["Bearer shd_at_test"]);
    // The second edit stays in Alice's outbox, to be sent when she reconnects.
    expect(await listOutbox(db, SCOPE)).toHaveLength(1);
  });

  it("waits at least as long as the server's Retry-After", async () => {
    const { db, deps } = await setup(() => json(429, { error: { code: "RATE_LIMITED", message: "Slow down", retryAfterSeconds: 40 } }));
    await queuedEdit(db, 2);
    expect(await pushNow(deps)).toMatchObject({ status: "error", retryAt: "2026-10-16T08:00:40.000Z" });
  });

  it("stops when the device was revoked, keeping every queued change", async () => {
    const { db, deps } = await setup(() => json(401, { error: { code: "DEVICE_REVOKED", message: "Revoked" } }));
    await queuedEdit(db, 2);
    expect(await pushNow(deps)).toEqual({ status: "disconnected" });
    expect(await db.account.get("connection")).toBeUndefined();
    expect(await db.outbox.count()).toBe(1);
  });

  it("keeps rejected changes for review, and treats a delete of something already gone as done", async () => {
    const { db, deps } = await setup((body) =>
      results(body, (op) => {
        if (op.action === "delete") return { status: "rejected", clientOperationId: op.clientOperationId, entityId: op.entityId, code: "NOT_FOUND", message: "Gone", replayed: false };
        if (op.expectedVersion === 0) return { status: "rejected", clientOperationId: op.clientOperationId, entityId: op.entityId, code: "ID_IN_USE", message: "Id taken", replayed: false };
        return { status: "validation_error", clientOperationId: op.clientOperationId, message: "Invalid", issues: [] };
      }),
    );
    const taken = await queuedEdit(db, null, "Taken", 2);
    const invalid = await queuedEdit(db, 5, "Invalid", 3);
    const gone = sampleSession({ name: "Gone" }, 4);
    await seedAccountSession(db, ALICE, gone, { serverVersion: 2, state: "synced" });
    await deleteSession(db, gone.id, { now: T0, createId: ids });

    expect(await pushNow(deps)).toEqual({ status: "done", accepted: 1, conflicts: 0, rejected: 2, remaining: 0 });
    expect((await listOutbox(db, SCOPE)).map(({ entityId, status }) => [entityId, status])).toEqual([[taken.id, "rejected"], [invalid.id, "rejected"]]);
    expect((await db.sessions.get(taken.id))?.sync?.state).toBe("conflict");
    expect((await db.sessions.get(invalid.id))?.sync?.state).toBe("error");
    expect(await db.sessionTombstones.get(gone.id)).toBeDefined();
  });

  it("keeps a change `sending` when the server can't save it yet, and retries later", async () => {
    const { db, deps } = await setup((body) => results(body, (op) => ({ status: "retryable_error", clientOperationId: op.clientOperationId, message: "Busy" })));
    await queuedEdit(db, 2);
    expect(await pushNow(deps)).toMatchObject({ status: "error", retryAt: "2026-10-16T08:00:05.000Z" });
    expect(await listOutbox(db, SCOPE)).toMatchObject([{ status: "sending" }]);
  });

  it("sets aside a session too large to ever upload, without blocking the others", async () => {
    const { db, deps, calls } = await setup(acceptAll);
    const huge = sampleSession({ name: "Huge" }, 2);
    const tabs = Array.from({ length: 200 }, (_, index) => ({ ...huge.windows[0]!.tabs[1]!, id: ids(), url: `https://x.test/${"a".repeat(8000)}`, sortOrder: index, groupId: null }));
    await seedAccountSession(db, ALICE, { ...huge, windows: [{ ...huge.windows[0]!, groups: [], tabs }] }, { serverVersion: 1, state: "synced" });
    await updateSession(db, huge.id, 1, (current) => renameSession(current, "Huge, edited", T0), { now: T0, createId: ids });
    const small = await queuedEdit(db, 1, "Small", 3);

    expect(await pushNow(deps)).toMatchObject({ status: "done", accepted: 1 });
    expect(calls[0]!.body.operations.map((op) => op.entityId)).toEqual([small.id]);
    expect(await listOutbox(db, SCOPE)).toMatchObject([{ entityId: huge.id, status: "rejected", lastError: expect.stringMatching(/too large/) }]);
    expect((await db.sessions.get(huge.id))?.sync?.state).toBe("error");
  });

  it("arms the retry alarm when the round cap stops a run with sendable work left", async () => {
    const { db, deps, calls, scheduleRetry } = await setup(acceptAll);
    for (let prefix = 100; prefix < 351; prefix += 1) await queuedEdit(db, 1, "Edited", prefix);

    expect(await pushNow(deps)).toEqual({ status: "done", accepted: 250, conflicts: 0, rejected: 0, remaining: 1 });
    expect(calls).toHaveLength(10);
    expect(scheduleRetry).toHaveBeenCalledWith(T0);
    expect(await db.syncState.get(SCOPE)).toMatchObject({ failures: 0, nextAttemptAt: null });

    expect(await pushNow(deps)).toEqual({ status: "done", accepted: 1, conflicts: 0, rejected: 0, remaining: 0 });
    expect(scheduleRetry).toHaveBeenCalledTimes(1);
  });

  it("doesn't arm the alarm for work held back behind a conflict", async () => {
    const { db, deps, calls, scheduleRetry } = await setup(acceptAll);
    const held = await queuedEdit(db, 3, "A first", 2);
    for (const operation of await listOutbox(db, SCOPE)) await db.outbox.put({ ...operation, status: "conflict" });
    await updateSession(db, held.id, held.version, (current) => renameSession(current, "A second", T0), { now: T0, createId: ids });
    for (let prefix = 100; prefix < 350; prefix += 1) await queuedEdit(db, 1, "Edited", prefix);

    expect(await pushNow(deps)).toEqual({ status: "done", accepted: 250, conflicts: 0, rejected: 0, remaining: 1 });
    expect(calls).toHaveLength(10);
    expect(scheduleRetry).not.toHaveBeenCalled();
  });

  it("runs one upload at a time: a second call shares the run in progress", async () => {
    let release: () => void = () => undefined;
    const { db, deps, fetch } = await setup(async (body, database) => {
      await new Promise<void>((resolve) => (release = resolve));
      return acceptAll(body, database);
    });
    await queuedEdit(db, 2);
    const first = pushNow(deps);
    const second = pushNow(deps);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    release();
    expect(await second).toBe(await first);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("runs as part of the worker's `sync.now` command, before the download", async () => {
    const { db, deps } = await setup(acceptAll);
    const session = await queuedEdit(db, 2);
    const response = await handleCommand(
      { type: "sync.now" },
      { db, readWindows: async () => sampleWindows(), restoreWindow: async () => [], now: deps.now, createId: ids, account: deps.account, sync: { random: deps.random, scheduleRetry: deps.scheduleRetry } },
    );
    expect(response).toEqual({
      ok: true,
      data: {
        push: { status: "done", accepted: 1, conflicts: 0, rejected: 0, remaining: 0 },
        pull: { status: "done", applied: 0, held: 0, skipped: 0, bootstrapped: true },
      },
    });
    expect((await getSession(db, session.id))?.name).toBe("Edited");
    expect((await db.sessions.get(session.id))?.sync).toEqual({ serverVersion: 3, state: "synced" });
  });
});
