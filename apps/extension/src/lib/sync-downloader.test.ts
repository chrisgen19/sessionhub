import { describe, expect, it, vi } from "vitest";
import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import type { SavedSession } from "@sessionhub/contracts/session";
import { renameSession } from "@sessionhub/core/session-edit";
import { accountScope } from "./account-scope";
import type { AccountDeps } from "./account-service";
import type { SessionHubDb } from "./db";
import { listOutbox } from "./outbox-repository";
import { deleteSession, putSession, updateSession } from "./session-repository";
import { disableSync } from "./sync-consent";
import { pullNow } from "./sync-downloader";
import type { SyncDeps } from "./sync-gate";
import { syncNow } from "./sync-runner";
import { pushNow } from "./sync-uploader";
import { connectAs, freshDb, idFactory, sampleSession, seedAccountSession } from "./test-fixtures";

const ALICE = "AliceAccount00000000000000000000";
const BOB = "BobAccount0000000000000000000000";
const SCOPE = accountScope(ALICE);
const T0 = new Date("2026-10-16T08:00:00.000Z");
const ids = idFactory(7);
const cursor = (label: string) => `c1.${label}.AAAAAAAAAAAAAAAAAAAAAA`;

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const pullPage = (changes: object[], next: string, hasMore = false): Route => (url) =>
  json(200, { protocolVersion: 1, cursor: url.searchParams.get("cursor"), nextCursor: next, hasMore, changes });
const bootstrap = (items: object[], at: string, nextAfter: string | null = null): Route => () =>
  json(200, { protocolVersion: 1, cursor: at, nextAfter, hasMore: nextAfter !== null, items });
const acceptPush: Route = (_url, init) => {
  const body = JSON.parse(String(init?.body)) as { operations: { clientOperationId: string; entityId: string; expectedVersion: number }[] };
  return json(200, { protocolVersion: 1, results: body.operations.map((op) => ({ status: "accepted", clientOperationId: op.clientOperationId, entityId: op.entityId, serverVersion: op.expectedVersion + 1, serverSequence: "9", replayed: false })) });
};

/** A connected, sync-enabled browser; each route answers from its queue (the last answer repeats). */
const setup = async (routes: Record<string, Route[]>, state: { cursor: string | null } = { cursor: null }) => {
  const db = freshDb();
  const calls: string[] = [];
  const fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}${url.search}`);
    const queue = routes[url.pathname];
    if (!queue?.length) throw new TypeError("fetch failed");
    return (queue.length > 1 ? queue.shift()! : queue[0]!)(url, init);
  });
  const account: AccountDeps = { db, fetch: fetch as unknown as typeof globalThis.fetch, now: () => T0, createId: ids, apiOrigin: "https://sessionhub.example", openTab: async () => undefined, platformOs: async () => "mac" };
  const scheduleRetry = vi.fn(async (_at: Date) => undefined);
  const deps: SyncDeps = { db, now: () => T0, random: () => 1, account, scheduleRetry };
  await connectAs(db, ALICE);
  await db.syncState.put({ scope: SCOPE, enabledAt: T0.toISOString(), cursor: state.cursor, lastSyncAt: null, lastError: null, failures: 0, nextAttemptAt: null });
  return { db, deps, calls, fetch, scheduleRetry };
};

/** The server's view of a session at `version`. */
const detail = (session: SavedSession, version: number, name = session.name): ApiSessionDetail => ({
  id: session.id,
  name,
  description: null,
  workspaceId: null,
  sourceDeviceId: session.sourceDeviceId,
  sourceDeviceName: "Chrome on Windows",
  isPinned: false,
  isArchived: false,
  version,
  tabCount: 4,
  windowCount: 2,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  windows: session.windows,
});
let sequence = 0;
const upsert = (session: SavedSession, version: number, name?: string) => ({ sequence: String(++sequence), entityType: "savedSession", entityId: session.id, action: "upsert", version, payload: detail(session, version, name) });
const removal = (id: string, version: number) => ({ sequence: String(++sequence), entityType: "savedSession", entityId: id, action: "delete", version, payload: null });
const item = ({ sequence: _sequence, ...rest }: ReturnType<typeof upsert>) => rest;

const local = (db: SessionHubDb, id: string) => db.sessions.get(id);
const synced = async (db: SessionHubDb, prefix: number, serverVersion: number, name = `Session ${prefix}`) => {
  const session = sampleSession({ name }, prefix);
  await seedAccountSession(db, ALICE, session, { serverVersion, state: "synced" });
  return session;
};

describe("sync download", () => {
  it("downloads nothing until sync is turned on for the connected account", async () => {
    const { db, deps, fetch } = await setup({});
    await db.syncState.update(SCOPE, { enabledAt: null });
    expect(await pullNow(deps)).toEqual({ status: "disabled" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bootstraps an empty account cache page by page, then pulls from the first page's cursor", async () => {
    const a = sampleSession({ name: "A" }, 2);
    const b = sampleSession({ name: "B" }, 3);
    const { db, deps, calls } = await setup({
      "/api/v1/sync/bootstrap": [bootstrap([item(upsert(a, 2))], cursor("5"), a.id), bootstrap([{ entityType: "savedSession", entityId: b.id, action: "delete", version: 3, payload: null }], cursor("9"))],
      "/api/v1/sync/pull": [pullPage([], cursor("5"))],
    });

    expect(await pullNow(deps)).toEqual({ status: "done", applied: 1, held: 0, skipped: 1, bootstrapped: true });
    expect(calls).toEqual(["/api/v1/sync/bootstrap", `/api/v1/sync/bootstrap?after=${a.id}`, `/api/v1/sync/pull?cursor=${encodeURIComponent(cursor("5"))}`]);
    expect(await local(db, a.id)).toMatchObject({ name: "A", scope: SCOPE, version: 1, sourceDeviceName: "Chrome on Windows", sync: { serverVersion: 2, state: "synced" } });
    expect(await local(db, b.id)).toBeUndefined();
    expect(await db.syncState.get(SCOPE)).toMatchObject({ cursor: cursor("5"), bootstrap: null, lastSyncAt: T0.toISOString() });
  });

  it("applies newer changes in order, ignoring its own echoes, stale versions and workspaces", async () => {
    const { db, deps } = await setup({}, { cursor: cursor("1") });
    const s1 = await synced(db, 2, 2);
    const s3 = await synced(db, 4, 3);
    const s2 = sampleSession({ name: "New elsewhere" }, 3);
    const workspace = { sequence: String(++sequence), entityType: "workspace", entityId: ids(), action: "upsert", version: 1, payload: { id: "w" } };
    const page = [upsert(s1, 2, "Own echo"), upsert(s2, 1), removal(s3.id, 4), workspace, upsert(s1, 5, "From another device")];
    deps.account.fetch = vi.fn(async (input: URL | RequestInfo) => pullPage(page, cursor("9"))(new URL(String(input)))) as unknown as typeof globalThis.fetch;

    expect(await pullNow(deps)).toEqual({ status: "done", applied: 3, held: 0, skipped: 2, bootstrapped: false });
    expect(await local(db, s1.id)).toMatchObject({ name: "From another device", version: 2, sync: { serverVersion: 5, state: "synced" } });
    expect(await local(db, s2.id)).toMatchObject({ name: "New elsewhere", sync: { serverVersion: 1, state: "synced" } });
    expect(await local(db, s3.id)).toBeUndefined();
    expect((await db.syncState.get(SCOPE))?.cursor).toBe(cursor("9"));
  });

  it("never overwrites a session with changes waiting; applies the newer held copy once the upload is accepted", async () => {
    const { db, deps } = await setup({ "/api/v1/sync/push": [acceptPush] }, { cursor: cursor("1") });
    const s = await synced(db, 2, 2);
    await updateSession(db, s.id, s.version, (current) => renameSession(current, "Renamed here", T0), { now: T0, createId: ids });
    const page = [upsert(s, 3, "Own upload, seen early"), upsert(s, 4, "Another device, later")];
    const pushFetch = deps.account.fetch;
    deps.account.fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) =>
      new URL(String(input)).pathname === "/api/v1/sync/pull" ? pullPage(page, cursor("9"))(new URL(String(input))) : pushFetch(input, init),
    ) as unknown as typeof globalThis.fetch;

    expect(await pullNow(deps)).toMatchObject({ status: "done", applied: 0, held: 2 });
    expect(await local(db, s.id)).toMatchObject({ name: "Renamed here", sync: { serverVersion: 2, state: "pending" } });
    expect(await db.serverCopies.get(s.id)).toMatchObject({ version: 4, action: "upsert", scope: SCOPE });

    // The upload is accepted as version 3; the held version 4 is newer and nothing else waits.
    expect(await pushNow(deps)).toMatchObject({ status: "done", accepted: 1 });
    expect(await local(db, s.id)).toMatchObject({ name: "Another device, later", sync: { serverVersion: 4, state: "synced" } });
    expect(await db.serverCopies.count()).toBe(0);
  });

  it("keeps the held copy for review when the waiting upload conflicts", async () => {
    const conflict: Route = (_url, init) => {
      const [op] = (JSON.parse(String(init?.body)) as { operations: { clientOperationId: string; entityId: string }[] }).operations;
      return json(200, { protocolVersion: 1, results: [{ status: "conflict", clientOperationId: op!.clientOperationId, entityId: op!.entityId, code: "VERSION_CONFLICT", expectedVersion: 2, serverVersion: 3, message: "Changed", replayed: false }] });
    };
    const s = sampleSession({ name: "Mine" }, 2);
    const { db, deps } = await setup({ "/api/v1/sync/pull": [pullPage([upsert(s, 3, "Theirs")], cursor("9"))], "/api/v1/sync/push": [conflict] }, { cursor: cursor("1") });
    await seedAccountSession(db, ALICE, s, { serverVersion: 2, state: "synced" });
    await updateSession(db, s.id, 1, (current) => renameSession(current, "Mine, edited", T0), { now: T0, createId: ids });

    await pullNow(deps);
    await pushNow(deps);
    expect(await local(db, s.id)).toMatchObject({ name: "Mine, edited", sync: { state: "conflict" } });
    expect(await db.serverCopies.get(s.id)).toMatchObject({ version: 3, payload: { name: "Theirs" } });
    expect(await listOutbox(db, SCOPE)).toMatchObject([{ status: "conflict" }]);
  });

  it("never brings back a local delete; the server's delete ends the tombstone", async () => {
    const d = sampleSession({ name: "Deleted here" }, 2);
    const { db, deps } = await setup({ "/api/v1/sync/pull": [pullPage([upsert(d, 2), removal(d.id, 3)], cursor("9"))] }, { cursor: cursor("1") });
    await seedAccountSession(db, ALICE, d, { serverVersion: 2, state: "synced" });
    await deleteSession(db, d.id, { now: T0, createId: ids });
    await db.outbox.clear(); // its delete was accepted earlier

    expect(await pullNow(deps)).toMatchObject({ applied: 1, skipped: 1 });
    expect(await local(db, d.id)).toBeUndefined();
    expect(await db.sessionTombstones.count()).toBe(0);
  });

  it("never touches this browser's own session, even with the same id", async () => {
    const own = sampleSession({ name: "Local only" }, 2);
    const { db, deps } = await setup({ "/api/v1/sync/pull": [pullPage([upsert(own, 7, "Overwritten?")], cursor("9"))] }, { cursor: cursor("1") });
    await putSession(db, own);
    expect(await pullNow(deps)).toMatchObject({ applied: 0, skipped: 1 });
    expect(await local(db, own.id)).toEqual({ ...own, scope: "local" });
  });

  it("rebuilds from bootstrap when the cursor expired, keeping queued changes untouched", async () => {
    const s = sampleSession({ name: "Waiting" }, 2);
    const { db, deps, calls } = await setup(
      {
        "/api/v1/sync/pull": [() => json(410, { error: { code: "CURSOR_EXPIRED", message: "Gone" } }), pullPage([], cursor("20"))],
        "/api/v1/sync/bootstrap": [bootstrap([item(upsert(s, 6, "Server copy"))], cursor("20"))],
      },
      { cursor: cursor("3") },
    );
    await seedAccountSession(db, ALICE, s, { serverVersion: 2, state: "synced" });
    await updateSession(db, s.id, 1, (current) => renameSession(current, "Waiting, edited", T0), { now: T0, createId: ids });

    expect(await pullNow(deps)).toEqual({ status: "done", applied: 0, held: 1, skipped: 0, bootstrapped: true });
    expect(calls.map((call) => call.split("?")[0])).toEqual(["/api/v1/sync/pull", "/api/v1/sync/bootstrap", "/api/v1/sync/pull"]);
    expect(await local(db, s.id)).toMatchObject({ name: "Waiting, edited" });
    expect(await listOutbox(db, SCOPE)).toHaveLength(1);
    expect((await db.syncState.get(SCOPE))?.cursor).toBe(cursor("20"));
  });

  it("commits a page and its cursor together: a failed write keeps neither", async () => {
    const s = sampleSession({ name: "New" }, 2);
    const { db, deps } = await setup({ "/api/v1/sync/pull": [pullPage([upsert(s, 1)], cursor("9"))] }, { cursor: cursor("1") });
    const put = vi.spyOn(db.sessions, "put").mockRejectedValueOnce(new Error("disk failure"));
    await expect(pullNow(deps)).rejects.toThrow("disk failure");
    put.mockRestore();
    expect(await local(db, s.id)).toBeUndefined();
    expect((await db.syncState.get(SCOPE))?.cursor).toBe(cursor("1"));
  });

  it("skips a change it can't read instead of blocking the page", async () => {
    const good = sampleSession({ name: "Readable" }, 2);
    const bad = sampleSession({ name: "Broken" }, 3);
    const broken = { ...upsert(bad, 1), payload: { id: bad.id, name: 42 } };
    const { db, deps } = await setup({ "/api/v1/sync/pull": [pullPage([broken, upsert(good, 1)], cursor("9"))] }, { cursor: cursor("1") });
    expect(await pullNow(deps)).toMatchObject({ applied: 1, skipped: 1 });
    expect(await local(db, good.id)).toBeDefined();
    expect((await db.syncState.get(SCOPE))?.cursor).toBe(cursor("9"));
  });

  it("stops at the next page when sync is turned off during a run", async () => {
    const s = sampleSession({ name: "New elsewhere" }, 2);
    const { db, deps, scheduleRetry } = await setup({}, { cursor: cursor("1") });
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      await disableSync(db);
      return pullPage([upsert(s, 1)], cursor("2"), true)(new URL(String(input)));
    });
    deps.account.fetch = fetch as unknown as typeof globalThis.fetch;

    expect(await pullNow(deps)).toEqual({ status: "disabled" });
    expect(fetch).toHaveBeenCalledTimes(1);
    // The page already on its way is kept; nothing more is asked for.
    expect(await local(db, s.id)).toBeDefined();
    expect((await db.syncState.get(SCOPE))?.cursor).toBe(cursor("2"));
    expect(scheduleRetry).not.toHaveBeenCalled();
  });

  it("backs off when the server can't be reached", async () => {
    const { deps, scheduleRetry } = await setup({}, { cursor: cursor("1") });
    expect(await pullNow(deps)).toMatchObject({ status: "error", retryAt: "2026-10-16T08:00:05.000Z" });
    expect(scheduleRetry).toHaveBeenCalledWith(new Date("2026-10-16T08:00:05.000Z"));
  });

  it("keeps backing off while uploads work but downloads keep failing, until a whole run succeeds", async () => {
    const routes: Record<string, Route[]> = { "/api/v1/sync/push": [acceptPush] };
    const { db, deps } = await setup(routes, { cursor: cursor("1") });
    for (const seconds of [5, 10, 20]) {
      expect((await syncNow(deps, { force: true })).pull).toMatchObject({ status: "error", retryAt: new Date(T0.getTime() + seconds * 1000).toISOString() });
    }
    expect(await db.syncState.get(SCOPE)).toMatchObject({ failures: 3 });
    routes["/api/v1/sync/pull"] = [pullPage([], cursor("2"))];
    expect((await syncNow(deps, { force: true })).pull).toMatchObject({ status: "done" });
    expect(await db.syncState.get(SCOPE)).toMatchObject({ failures: 0, nextAttemptAt: null, lastError: null });
  });

  it("stops when another account connects mid-run: none of its data lands in this account's cache", async () => {
    const mine = sampleSession({ name: "Alice's" }, 2);
    const theirs = sampleSession({ name: "Bob's" }, 3);
    const routes: Record<string, Route[]> = {};
    const { db, deps, fetch } = await setup(routes, { cursor: cursor("1") });
    const asBob = (init?: RequestInit) => new Headers(init?.headers).get("authorization") === "Bearer shd_at_bob";
    routes["/api/v1/sync/pull"] = [
      async (url, init) => {
        // The server refuses Alice's cursor for Bob, which used to send this run into a rebuild with Bob's token.
        if (asBob(init)) return json(400, { error: { code: "INVALID_CURSOR", message: "Not this account's cursor" } });
        // Alice's first page is in flight when the user disconnects and pairs Bob's account.
        await connectAs(db, BOB, "shd_at_bob");
        return pullPage([upsert(mine, 1)], cursor("2"), true)(url, init);
      },
    ];
    routes["/api/v1/sync/bootstrap"] = [bootstrap([item(upsert(theirs, 1))], cursor("7"))];

    expect(await pullNow(deps)).toEqual({ status: "disconnected" });
    expect(fetch.mock.calls.map(([, init]) => new Headers(init?.headers).get("authorization"))).toEqual(["Bearer shd_at_test"]);
    expect(await local(db, theirs.id)).toBeUndefined();
    // Alice's page arrived after the switch, so it isn't kept either: her cursor waits for her next run.
    expect(await local(db, mine.id)).toBeUndefined();
    expect(await db.syncState.get(SCOPE)).toMatchObject({ cursor: cursor("1"), failures: 0, lastError: null });
  });
});
