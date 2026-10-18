import { describe, expect, it } from "vitest";
import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import type { SavedSession } from "@sessionhub/contracts/session";
import { accountScope } from "./account-scope";
import { handleCommand, type HandlerDeps } from "./command-handlers";
import type { SessionHubDb } from "./db";
import { listOutbox } from "./outbox-repository";
import { getSession, putSession } from "./session-repository";
import { applyRemoteChange } from "./sync-apply";
import { toPushOperation } from "./sync-batch";
import { connectAs, freshDb, idFactory, sampleSession, seedAccountSession } from "./test-fixtures";
import { createWorkspace } from "./workspace-repository";

const ALICE = "AliceAccount00000000000000000000";
const SCOPE = accountScope(ALICE);
const T0 = new Date("2026-10-18T08:00:00.000Z");

// One id source for the whole file: queued uploads need distinct ids across commands.
const ids = idFactory(9);
const depsFor = (db: SessionHubDb): HandlerDeps => ({ db, readWindows: async () => [], restoreWindow: async () => [], now: () => T0, createId: ids });
const run = async (db: SessionHubDb, command: unknown) => {
  const response = await handleCommand(command, depsFor(db));
  if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
  return response.data as Record<string, unknown>;
};

/** A connected browser with sync on, one session only here (prefix 1) and two in the account (2, 3). */
const setup = async () => {
  const db = freshDb();
  await connectAs(db, ALICE);
  await db.syncState.put({ scope: SCOPE, enabledAt: T0.toISOString(), cursor: null, lastSyncAt: null, lastError: null, failures: 0, nextAttemptAt: null });
  const local = sampleSession({ name: "Only here" }, 1);
  await putSession(db, local);
  const account = [2, 3].map((prefix) => sampleSession({ name: `Account ${prefix}` }, prefix));
  for (const session of account) await seedAccountSession(db, ALICE, session, { serverVersion: 1, state: "synced" });
  await db.sessions.update(account[0]!.id, { workspaceId: null });
  return { db, local, account };
};

const uploads = async (db: SessionHubDb) => (await listOutbox(db, SCOPE)).map((operation) => ({ entityId: operation.entityId, action: operation.action, payload: operation.payload && toPushOperation(operation).payload }));

describe("editing one session's details", () => {
  it("stores notes, tags and pinned on a session of this browser without queuing anything", async () => {
    const { db, local } = await setup();
    expect(await run(db, { type: "session.edit", sessionId: local.id, expectedVersion: 1, description: " Read first ", tags: ["work", "Work"], isPinned: true })).toEqual({ version: 2 });
    expect(await getSession(db, local.id)).toMatchObject({ description: "Read first", tags: ["work"], isPinned: true, version: 2 });
    expect(await uploads(db)).toEqual([]);
  });

  it("queues an account session's upload with every known field", async () => {
    const { db, account } = await setup();
    await run(db, { type: "session.edit", sessionId: account[0]!.id, expectedVersion: 1, isArchived: true, tags: ["q4"] });
    expect(await uploads(db)).toEqual([
      { entityId: account[0]!.id, action: "upsert", payload: expect.objectContaining({ workspaceId: null, description: null, tags: ["q4"], isPinned: false, isArchived: true }) },
    ]);
  });

  it("refuses a stale version and invalid tags, changing nothing", async () => {
    const { db, local } = await setup();
    expect(await handleCommand({ type: "session.edit", sessionId: local.id, expectedVersion: 5, isPinned: true }, depsFor(db))).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(await handleCommand({ type: "session.edit", sessionId: local.id, expectedVersion: 1, tags: ["x".repeat(33)] }, depsFor(db))).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect((await getSession(db, local.id))?.version).toBe(1);
  });
});

describe("duplicate", () => {
  it("saves a copy where new saves go, with notes and tags, unpinned", async () => {
    const { db, account } = await setup();
    await run(db, { type: "session.edit", sessionId: account[0]!.id, expectedVersion: 1, description: "Notes", tags: ["work"], isPinned: true });
    const { sessionId, syncing } = await run(db, { type: "session.duplicate", sessionId: account[0]!.id });
    expect(syncing).toBe(true);
    expect(await getSession(db, sessionId as string)).toMatchObject({ name: "Account 2 (copy)", description: "Notes", tags: ["work"], isPinned: false, isArchived: false, version: 1 });
  });
});

describe("bulk actions", () => {
  it("archives every selected session in one go; one already archived isn't counted", async () => {
    const { db, local, account } = await setup();
    await run(db, { type: "session.edit", sessionId: account[1]!.id, expectedVersion: 1, isArchived: true });
    const result = await run(db, { type: "session.bulk", sessionIds: [local.id, ...account.map((s) => s.id)], action: { kind: "archive", archived: true } });
    expect(result).toEqual({ changed: 2, notInAccount: 0, tooManyTags: 0 });
    for (const session of [local, ...account]) expect((await getSession(db, session.id))?.isArchived).toBe(true);
    // Account sessions each queue one upload; the local one queues none.
    expect((await uploads(db)).map((upload) => upload.entityId).sort()).toEqual(account.map((s) => s.id).sort());
  });

  it("adds a tag to sessions with room and counts those already at the limit", async () => {
    const { db, local, account } = await setup();
    await run(db, { type: "session.edit", sessionId: local.id, expectedVersion: 1, tags: Array.from({ length: 10 }, (_, index) => `t${index}`) });
    const result = await run(db, { type: "session.bulk", sessionIds: [local.id, account[0]!.id], action: { kind: "tag", tag: " Review ", add: true } });
    expect(result).toEqual({ changed: 1, notInAccount: 0, tooManyTags: 1 });
    expect((await getSession(db, account[0]!.id))?.tags).toEqual(["Review"]);
    const removed = await run(db, { type: "session.bulk", sessionIds: [account[0]!.id], action: { kind: "tag", tag: "review", add: false } });
    expect(removed).toMatchObject({ changed: 1 });
    expect((await getSession(db, account[0]!.id))?.tags).toEqual([]);
  });

  it("moves account sessions into a workspace and counts sessions only in this browser", async () => {
    const { db, local, account } = await setup();
    const { workspaceId } = await createWorkspace(db, { name: "Alpha", color: null }, { now: T0, createId: idFactory(7) });
    const result = await run(db, { type: "session.bulk", sessionIds: [local.id, ...account.map((s) => s.id)], action: { kind: "assign", workspaceId } });
    expect(result).toEqual({ changed: 2, notInAccount: 1, tooManyTags: 0 });
    for (const session of account) expect((await db.sessions.get(session.id))?.workspaceId).toBe(workspaceId);
  });

  it("deletes every selected session; account sessions leave tombstones and queued deletes", async () => {
    const { db, local, account } = await setup();
    expect(await run(db, { type: "session.bulk", sessionIds: [local.id, account[0]!.id], action: { kind: "delete" } })).toMatchObject({ changed: 2 });
    expect(await getSession(db, local.id)).toBeUndefined();
    expect(await getSession(db, account[0]!.id)).toBeUndefined();
    expect(await db.sessionTombstones.get(account[0]!.id)).toBeDefined();
    expect(await uploads(db)).toEqual([{ entityId: account[0]!.id, action: "delete", payload: null }]);
    expect(await getSession(db, account[1]!.id)).toBeDefined();
  });

  it("passes over sessions that no longer exist", async () => {
    const { db, local } = await setup();
    expect(await run(db, { type: "session.bulk", sessionIds: [local.id, "00000000-0000-4000-8000-00000000dead"], action: { kind: "archive", archived: true } })).toMatchObject({ changed: 1 });
  });
});

describe("downloads", () => {
  const detailOf = (session: SavedSession, version: number, fields: Partial<ApiSessionDetail> = {}): ApiSessionDetail => ({
    id: session.id, name: session.name, description: null, workspaceId: null, sourceDeviceId: session.sourceDeviceId, sourceDeviceName: session.sourceDeviceName,
    isPinned: false, isArchived: false, tags: [], version, tabCount: 4, windowCount: 2, createdAt: session.createdAt, updatedAt: session.updatedAt, windows: session.windows, ...fields,
  });

  it("stores the server's notes, tags, pinned and archived with a new version", async () => {
    const { db, account } = await setup();
    const change = { entityType: "savedSession" as const, entityId: account[0]!.id, action: "upsert" as const, version: 2, payload: detailOf(account[0]!, 2, { description: "From the web", tags: ["web"], isArchived: true }) };
    expect(await applyRemoteChange(db, SCOPE, change, T0.toISOString())).toBe("applied");
    expect(await getSession(db, account[0]!.id)).toMatchObject({ description: "From the web", tags: ["web"], isPinned: false, isArchived: true });
  });

  it("a session stored before these fields learns them from the same version (the rebuild), keeping what it knows", async () => {
    const { db, account } = await setup();
    await db.sessions.update(account[1]!.id, { isPinned: true });
    const change = { entityType: "savedSession" as const, entityId: account[1]!.id, action: "upsert" as const, version: 1, payload: detailOf(account[1]!, 1, { isArchived: true, tags: ["web"], isPinned: false }) };
    expect(await applyRemoteChange(db, SCOPE, change, T0.toISOString())).toBe("skipped");
    expect(await db.sessions.get(account[1]!.id)).toMatchObject({ isArchived: true, tags: ["web"], isPinned: true, description: null });
  });
});
