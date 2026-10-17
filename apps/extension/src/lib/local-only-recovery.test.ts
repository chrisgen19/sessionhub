import { describe, expect, it, vi } from "vitest";
import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import { accountScope } from "./account-scope";
import { resolveReview } from "./review-repository";
import { disableSync } from "./sync-consent";
import { pullNow } from "./sync-downloader";
import type { SyncDeps } from "./sync-gate";
import { connectAs, freshDb, idFactory, sampleSession, seedAccountSession } from "./test-fixtures";

const ALICE = "AliceAccount00000000000000000000";
const BOB = "BobAccount0000000000000000000000";
const SCOPE = accountScope(ALICE);
const NOW = new Date("2026-10-16T08:00:00.000Z");
const CURSOR = "c1.already-past-original.AAAAAAAAAAAAAAAAAAAAAA";
const NEXT_CURSOR = "c1.after-bootstrap.AAAAAAAAAAAAAAAAAAAAAA";
const ids = idFactory(8);
const context = { now: NOW, createId: ids };

/** The account is unchanged since version 3; its same-version echo wasn't held by pull. */
const setup = async ({ serverVersion = 3, code = "TOO_LARGE", copy = "absent" }: {
  serverVersion?: number | null;
  code?: string;
  copy?: "absent" | "upsert" | "delete";
} = {}) => {
  const db = freshDb();
  await connectAs(db, ALICE);
  const session = sampleSession({ name: "Rejected edit" }, 2);
  await seedAccountSession(db, ALICE, session, { serverVersion, state: "error" });
  await db.outbox.add({ id: ids(), scope: SCOPE, entityType: "savedSession", entityId: session.id, action: "upsert", payload: session,
    expectedVersion: serverVersion ?? 0, status: "rejected", attempts: 1, nextAttemptAt: null,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), lastError: "Can't upload this edit", lastErrorCode: code });
  await db.syncState.put({ scope: SCOPE, enabledAt: NOW.toISOString(), cursor: CURSOR, bootstrap: null,
    lastSyncAt: NOW.toISOString(), failures: 0, nextAttemptAt: null, lastError: null });
  const remote: ApiSessionDetail = { id: session.id, name: "Account version", description: null, workspaceId: null,
    sourceDeviceId: session.sourceDeviceId, sourceDeviceName: session.sourceDeviceName, windows: session.windows,
    createdAt: session.createdAt, updatedAt: session.updatedAt,
    isPinned: false, isArchived: false, version: serverVersion ?? 1, tabCount: 4, windowCount: 2 };
  if (copy !== "absent") await db.serverCopies.put({ id: session.id, scope: SCOPE, action: copy, version: remote.version,
    payload: copy === "upsert" ? remote : null, receivedAt: NOW.toISOString() });
  const fetch = vi.fn(async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    const body = url.pathname === "/api/v1/sync/bootstrap"
      ? { protocolVersion: 1, cursor: NEXT_CURSOR, nextAfter: null, hasMore: false,
        items: [{ entityType: "savedSession", entityId: session.id, action: "upsert", version: remote.version, payload: remote }] }
      : { protocolVersion: 1, cursor: url.searchParams.get("cursor"), nextCursor: NEXT_CURSOR, hasMore: false, changes: [] };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  const deps: SyncDeps = { db, now: () => NOW, random: () => 1, scheduleRetry: async () => undefined,
    account: { db, now: () => NOW, createId: ids, fetch: fetch as typeof globalThis.fetch, apiOrigin: "https://sessionhub.example", openTab: async () => undefined, platformOs: async () => "mac" } };
  return { db, session, remote, deps, fetch };
};

const snapshot = async (db: Awaited<ReturnType<typeof setup>>["db"]) => ({
  sessions: await db.sessions.toArray(), outbox: await db.outbox.toArray(), copies: await db.serverCopies.toArray(), sync: await db.syncState.toArray(),
});

describe("keeping a rejected edit in this browser", () => {
  it("recovers the unchanged account version after its cursor passed, without uploading the local copy", async () => {
    const { db, session, remote, deps, fetch } = await setup();
    const result = await resolveReview(db, session.id, "local-only", context);
    expect(result.sessionId).not.toBe(session.id);
    expect(await db.sessions.get(result.sessionId)).toMatchObject({ name: session.name, scope: "local", version: 1 });
    expect((await db.sessions.get(result.sessionId))?.windows.flatMap((window) => window.tabs.map((tab) => tab.url)))
      .toEqual(session.windows.flatMap((window) => window.tabs.map((tab) => tab.url)));
    expect(await db.syncState.get(SCOPE)).toMatchObject({ cursor: null, bootstrap: null, enabledAt: NOW.toISOString() });
    expect(fetch).not.toHaveBeenCalled();

    expect(await pullNow(deps)).toMatchObject({ status: "done", bootstrapped: true, applied: 1 });
    expect(await db.sessions.get(session.id)).toMatchObject({ name: remote.name, scope: SCOPE, sync: { serverVersion: 3, state: "synced" } });
    expect(await db.sessions.get(result.sessionId)).toMatchObject({ name: session.name, scope: "local" });
    expect(await db.outbox.count()).toBe(0);
    expect(fetch.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual(["/api/v1/sync/bootstrap", "/api/v1/sync/pull"]);
  });

  it("frees a taken id even when the rejected create has never synced", async () => {
    const { db, session } = await setup({ serverVersion: null, code: "ID_IN_USE" });
    const { sessionId } = await resolveReview(db, session.id, "local-only", context);
    expect(sessionId).not.toBe(session.id);
    expect(await db.sessions.get(session.id)).toBeUndefined();
    expect(await db.syncState.get(SCOPE)).toMatchObject({ cursor: null, bootstrap: null });
  });

  it("keeps a held account version immediately without resetting the cursor", async () => {
    const { db, session } = await setup({ copy: "upsert" });
    const { sessionId } = await resolveReview(db, session.id, "local-only", context);
    expect(await db.sessions.get(session.id)).toMatchObject({ name: "Account version", scope: SCOPE });
    expect(await db.sessions.get(sessionId)).toMatchObject({ name: "Rejected edit", scope: "local" });
    expect(await db.syncState.get(SCOPE)).toMatchObject({ cursor: CURSOR });
  });

  it("does not rebuild for an unaccepted create or a known server deletion", async () => {
    for (const options of [{ serverVersion: null }, { copy: "delete" as const }]) {
      const { db, session } = await setup(options);
      const { sessionId } = await resolveReview(db, session.id, "local-only", context);
      expect(sessionId).not.toBe(session.id);
      expect(await db.sessions.get(sessionId)).toMatchObject({ name: session.name, scope: "local" });
      expect(await db.syncState.get(SCOPE)).toMatchObject({ cursor: CURSOR });
    }
  });

  it("preserves sync-off consent and another account's cursor while abandoning partial bootstrap progress", async () => {
    const { db, session, deps, fetch } = await setup();
    await disableSync(db);
    await db.syncState.update(SCOPE, { bootstrap: { cursor: CURSOR, after: ids() } });
    const bob = { ...(await db.syncState.get(SCOPE))!, scope: accountScope(BOB), cursor: "bob-cursor" };
    await db.syncState.put(bob);
    await resolveReview(db, session.id, "local-only", context);
    expect(await db.syncState.get(SCOPE)).toMatchObject({ cursor: null, bootstrap: null, enabledAt: null });
    expect(await db.syncState.get(accountScope(BOB))).toEqual(bob);
    expect(await pullNow(deps)).toEqual({ status: "disabled" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves unrelated pending edits while refetching the account", async () => {
    const { db, session, deps } = await setup();
    const other = sampleSession({ name: "Other edit" }, 4);
    await seedAccountSession(db, ALICE, other, { serverVersion: 2, state: "pending" });
    const operation = { ...(await db.outbox.toArray())[0]!, id: ids(), seq: undefined, entityId: other.id, action: "upsert" as const, payload: other, status: "queued" as const };
    await db.outbox.add(operation);
    const before = await db.outbox.where("entityId").equals(other.id).toArray();
    await resolveReview(db, session.id, "local-only", context);
    await pullNow(deps);
    expect(await db.sessions.get(other.id)).toMatchObject({ name: other.name, sync: { state: "pending" } });
    expect(await db.outbox.where("entityId").equals(other.id).toArray()).toEqual(before);
  });

  it("rolls back sessions, operations and the cursor together if the refresh cannot be recorded", async () => {
    const { db, session } = await setup();
    const before = await snapshot(db);
    const update = vi.spyOn(db.syncState, "update").mockRejectedValueOnce(new Error("disk failure"));
    await expect(resolveReview(db, session.id, "local-only", context)).rejects.toThrow("disk failure");
    update.mockRestore();
    expect(await snapshot(db)).toEqual(before);
  });

  it("does not let a pull already in flight undo the durable refresh request", async () => {
    const { db, session, deps } = await setup();
    deps.account.fetch = vi.fn(async () => {
      await resolveReview(db, session.id, "local-only", context);
      return new Response(JSON.stringify({ protocolVersion: 1, cursor: CURSOR, nextCursor: NEXT_CURSOR, hasMore: false, changes: [] }),
        { headers: { "content-type": "application/json" } });
    });
    await pullNow(deps);
    expect(await db.syncState.get(SCOPE)).toMatchObject({ cursor: null, bootstrap: null });
  });
});
