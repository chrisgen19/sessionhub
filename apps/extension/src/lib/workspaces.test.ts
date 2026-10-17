import { describe, expect, it, vi } from "vitest";
import { renameSession } from "@sessionhub/core/session-edit";
import type { SavedSession } from "@sessionhub/contracts/session";
import { accountScope } from "./account-scope";
import type { AccountDeps } from "./account-service";
import { handleCommand, type HandlerDeps } from "./command-handlers";
import type { LocalWorkspaceRecord, SessionHubDb } from "./db";
import { listOutbox } from "./outbox-repository";
import { putSession, updateSession } from "./session-repository";
import { selectPushBatch, toPushOperation } from "./sync-batch";
import { pullNow } from "./sync-downloader";
import type { SyncDeps } from "./sync-gate";
import { readSyncOverview } from "./sync-overview";
import { syncNow } from "./sync-runner";
import { connectAs, freshDb, idFactory, sampleSession, seedAccountSession } from "./test-fixtures";
import { assignSession, createWorkspace, deleteWorkspace, readWorkspaces, updateWorkspace } from "./workspace-repository";
import { createTestServer, syncCursor } from "./workspace-test-server";

const ALICE = "AliceAccount00000000000000000000";
const SCOPE = accountScope(ALICE);
const T0 = new Date("2026-10-16T08:00:00.000Z");
const ids = idFactory(9);
const context = { now: T0, createId: ids };

const handlerDeps = (db: SessionHubDb): HandlerDeps => ({ db, readWindows: async () => [], restoreWindow: async () => [], now: () => T0, createId: ids });

/** A connected browser with sync on (a cursor makes runs pull; none makes them bootstrap). */
const setup = async ({ cursor = syncCursor(0) as string | null } = {}) => {
  const db = freshDb();
  const server = createTestServer();
  const account: AccountDeps = { db, fetch: server.fetch as unknown as typeof globalThis.fetch, now: () => T0, createId: ids, apiOrigin: "https://sessionhub.example", openTab: async () => undefined, platformOs: async () => "mac" };
  const deps: SyncDeps = { db, now: () => T0, random: () => 1, account, scheduleRetry: vi.fn(async () => undefined) };
  await connectAs(db, ALICE);
  await db.syncState.put({ scope: SCOPE, enabledAt: T0.toISOString(), cursor, lastSyncAt: null, lastError: null, failures: 0, nextAttemptAt: null });
  return { db, server, deps };
};

/** A workspace this browser already has from the account, at `serverVersion`. */
const syncedWorkspace = async (db: SessionHubDb, id: string, serverVersion: number, fields: Partial<LocalWorkspaceRecord> = {}) => {
  await db.workspaces.put({ id, scope: SCOPE, name: "Alpha", description: null, icon: null, color: "blue", position: 0, createdAt: T0.toISOString(), updatedAt: T0.toISOString(), sync: { serverVersion, state: "synced" }, deletedAt: null, ...fields });
};

/** An account session this browser already has, synced at `serverVersion` (workspace unknown unless given). */
const syncedSession = async (db: SessionHubDb, prefix: number, serverVersion: number, workspaceId?: string | null): Promise<SavedSession> => {
  const session = sampleSession({ name: `Session ${prefix}` }, prefix);
  await seedAccountSession(db, ALICE, session, { serverVersion, state: "synced" });
  if (workspaceId !== undefined) await db.sessions.update(session.id, { workspaceId });
  return session;
};

const outboxSummary = async (db: SessionHubDb) =>
  (await listOutbox(db, SCOPE)).map((operation) => ({ entityType: operation.entityType, entityId: operation.entityId, action: operation.action, expectedVersion: operation.expectedVersion, payload: operation.payload && toPushOperation(operation).payload }));

describe("workspaces in this browser", () => {
  it("creates, edits and assigns only in the connected account, each change with its upload queued", async () => {
    const db = freshDb();
    expect(await handleCommand({ type: "workspace.create", name: "Client Alpha", color: "blue" }, handlerDeps(db))).toMatchObject({ ok: false, error: { code: "account-error" } });
    await connectAs(db, ALICE);

    const { workspaceId } = await createWorkspace(db, { name: "  Client Alpha ", color: "blue" }, context);
    await updateWorkspace(db, workspaceId, { name: "Client A", color: "blue" }, context);
    expect(await handleCommand({ type: "workspace.update", workspaceId, name: "   " }, handlerDeps(db))).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect((await readWorkspaces(db)).workspaces).toMatchObject([{ id: workspaceId, name: "Client A", color: "blue", sync: { serverVersion: null, state: "pending" } }]);

    const session = await syncedSession(db, 2, 4);
    await assignSession(db, session.id, workspaceId, context);
    await updateSession(db, session.id, session.version, (current) => renameSession(current, "Renamed", T0), context);
    expect(await db.sessions.get(session.id)).toMatchObject({ name: "Renamed", workspaceId, sync: { serverVersion: 4, state: "pending" } });
    // One queued create (the edit merged into it) and one session upload carrying the workspace.
    expect(await outboxSummary(db)).toEqual([
      { entityType: "workspace", entityId: workspaceId, action: "upsert", expectedVersion: 0, payload: { name: "Client A", color: "blue" } },
      { entityType: "savedSession", entityId: session.id, action: "upsert", expectedVersion: 4, payload: expect.objectContaining({ name: "Renamed", workspaceId }) },
    ]);

    const mine = sampleSession({ name: "Only here" }, 3);
    await putSession(db, mine);
    expect(await handleCommand({ type: "session.assign", sessionId: mine.id, workspaceId }, handlerDeps(db))).toMatchObject({ ok: false, error: { code: "invalid-input", message: expect.stringContaining("Only sessions in your account") } });
    expect(await handleCommand({ type: "session.assign", sessionId: session.id, workspaceId: ids() }, handlerDeps(db))).toMatchObject({ ok: false, error: { code: "not-found" } });
  });

  it("uploads a session whose workspace isn't known yet without one, so the account keeps its own", async () => {
    const db = freshDb();
    await connectAs(db, ALICE);
    const session = await syncedSession(db, 2, 3);
    await updateSession(db, session.id, session.version, (current) => renameSession(current, "Renamed", T0), context);
    const [operation] = await listOutbox(db, SCOPE);
    expect(toPushOperation(operation!).payload).not.toHaveProperty("workspaceId");
    expect((await db.sessions.get(session.id))?.workspaceId).toBeUndefined();
  });

  it("refuses more workspaces than the account allows", async () => {
    const db = freshDb();
    await connectAs(db, ALICE);
    for (let index = 0; index < 100; index += 1) await syncedWorkspace(db, ids(), 1);
    expect(await handleCommand({ type: "workspace.create", name: "One too many", color: null }, handlerDeps(db))).toMatchObject({ ok: false, error: { code: "invalid-input", message: expect.stringContaining("up to 100") } });
  });

  it("moves sessions out before a delete, which waits for them; a workspace the account never got is just dropped", async () => {
    const db = freshDb();
    await connectAs(db, ALICE);
    const uploaded = ids();
    await syncedWorkspace(db, uploaded, 3);
    const a = await syncedSession(db, 2, 5, uploaded);
    const b = await syncedSession(db, 3, 2, uploaded);
    const other = await syncedSession(db, 4, 1, null);

    expect(await deleteWorkspace(db, uploaded, context)).toEqual({ moved: 2 });
    expect((await readWorkspaces(db)).workspaces).toEqual([]);
    expect(await db.workspaces.get(uploaded)).toMatchObject({ deletedAt: T0.toISOString() });
    expect((await db.sessions.get(a.id))?.workspaceId).toBeNull();
    expect((await db.sessions.get(other.id))?.sync).toEqual({ serverVersion: 1, state: "synced" });
    const outbox = await listOutbox(db, SCOPE);
    expect(await outboxSummary(db)).toMatchObject([
      { entityId: a.id, expectedVersion: 5, payload: { workspaceId: null } },
      { entityId: b.id, expectedVersion: 2, payload: { workspaceId: null } },
      { entityType: "workspace", entityId: uploaded, action: "delete", expectedVersion: 3, payload: null },
    ]);
    expect(outbox[2]).toMatchObject({ waitFor: [a.id, b.id] });
    // The delete waits for the unassignments, which go first.
    expect(selectPushBatch(outbox).operations.map((operation) => operation.entityId)).toEqual([a.id, b.id]);
    expect(selectPushBatch(outbox.slice(2)).operations.map((operation) => operation.entityId)).toEqual([uploaded]);

    const { workspaceId: unsent } = await createWorkspace(db, { name: "Never uploaded", color: null }, context);
    await assignSession(db, other.id, unsent, context);
    // The session waits for the workspace's create.
    expect(selectPushBatch(await listOutbox(db, SCOPE)).operations.map((operation) => operation.entityId)).toEqual([a.id, b.id, unsent]);
    expect(await deleteWorkspace(db, unsent, context)).toEqual({ moved: 1 });
    expect(await db.workspaces.get(unsent)).toBeUndefined();
    expect((await listOutbox(db, SCOPE)).filter((operation) => operation.entityId === unsent)).toEqual([]);
    expect(await outboxSummary(db)).toContainEqual(expect.objectContaining({ entityId: other.id, payload: expect.objectContaining({ workspaceId: null }) }));
  });
});

describe("workspace sync with the account", () => {
  it("uploads a new workspace before the sessions put in it, and the download of its own changes changes nothing", async () => {
    const { db, server, deps } = await setup();
    const session = await syncedSession(db, 2, 1, null);
    server.elsewhere.seedSession(session, 1);
    const { workspaceId } = await createWorkspace(db, { name: "Client Alpha", color: "green" }, context);
    await assignSession(db, session.id, workspaceId, context);

    expect(await syncNow(deps)).toMatchObject({ push: { status: "done", accepted: 2, remaining: 0 }, pull: { status: "done" } });
    expect(server.pushes.map((operations) => operations.map((operation) => operation.entityType))).toEqual([["workspace"], ["savedSession"]]);
    expect(server.sessions.get(session.id)).toMatchObject({ version: 2, workspaceId });
    expect(server.workspaces.get(workspaceId)).toMatchObject({ name: "Client Alpha", color: "green", version: 1 });
    expect(await db.workspaces.get(workspaceId)).toMatchObject({ name: "Client Alpha", sync: { serverVersion: 1, state: "synced" } });
    expect(await db.sessions.get(session.id)).toMatchObject({ workspaceId, sync: { serverVersion: 2, state: "synced" } });
    expect(await listOutbox(db, SCOPE)).toEqual([]);
  });

  it("merges edits made here and elsewhere per field, sending this browser's again on the newer version", async () => {
    const { db, server, deps } = await setup();
    const id = ids();
    server.elsewhere.addWorkspace(id, { name: "Alpha", color: "blue" });
    await syncedWorkspace(db, id, 1);
    await db.syncState.update(SCOPE, { cursor: syncCursor(1) });
    await updateWorkspace(db, id, { color: "red" }, context);
    server.elsewhere.editWorkspace(id, { name: "Alpha (client)" });

    expect(await syncNow(deps)).toMatchObject({ push: { status: "done", accepted: 1, conflicts: 0, rejected: 0 } });
    // Sent again on version 2 with only the color: the other browser's name stays.
    expect(server.pushes[1]).toMatchObject([{ entityId: id, expectedVersion: 2, payload: { color: "red" } }]);
    expect(server.pushes[1]![0]!.payload).not.toHaveProperty("name");
    expect(server.workspaces.get(id)).toMatchObject({ name: "Alpha (client)", color: "red", version: 3 });
    expect(await db.workspaces.get(id)).toMatchObject({ name: "Alpha (client)", color: "red", sync: { serverVersion: 3, state: "synced" } });
  });

  it("shows a pulled edit with the field still waiting here on top", async () => {
    const { db, server, deps } = await setup();
    const id = ids();
    server.elsewhere.addWorkspace(id, { name: "Alpha", color: "blue" });
    await syncedWorkspace(db, id, 1);
    await db.syncState.update(SCOPE, { cursor: syncCursor(1) });
    await updateWorkspace(db, id, { color: "red" }, context);
    server.elsewhere.editWorkspace(id, { name: "Alpha (client)" });

    expect(await pullNow(deps)).toMatchObject({ status: "done", applied: 1 });
    expect(await db.workspaces.get(id)).toMatchObject({ name: "Alpha (client)", color: "red", sync: { serverVersion: 2, state: "pending" } });
  });

  it("lets deletes win over edits both ways", async () => {
    const { db, server, deps } = await setup();
    const deletedHere = ids();
    const deletedThere = ids();
    server.elsewhere.addWorkspace(deletedHere);
    server.elsewhere.addWorkspace(deletedThere);
    await syncedWorkspace(db, deletedHere, 1);
    await syncedWorkspace(db, deletedThere, 1);
    const session = await syncedSession(db, 2, 1, deletedThere);
    await db.syncState.update(SCOPE, { cursor: syncCursor(2) });
    await deleteWorkspace(db, deletedHere, context);
    await updateWorkspace(db, deletedThere, { name: "Renamed here" }, context);
    server.elsewhere.editWorkspace(deletedHere, { name: "Renamed elsewhere" });
    server.elsewhere.deleteWorkspace(deletedThere);

    expect(await syncNow(deps)).toMatchObject({ push: { status: "done", remaining: 0 }, pull: { status: "done" } });
    expect(server.workspaces.get(deletedHere)).toMatchObject({ deleted: true });
    expect(await db.workspaces.get(deletedHere)).toBeUndefined();
    expect(await db.workspaces.get(deletedThere)).toBeUndefined();
    expect((await db.sessions.get(session.id))?.workspaceId).toBeNull();
    expect(await listOutbox(db, SCOPE)).toEqual([]);
  });

  it("brings a workspace back when the account refuses its delete because another browser put a session in it", async () => {
    const { db, server, deps } = await setup();
    const id = ids();
    server.elsewhere.addWorkspace(id);
    await syncedWorkspace(db, id, 1);
    const mine = await syncedSession(db, 2, 1, id);
    const theirs = sampleSession({ name: "Theirs" }, 3);
    server.elsewhere.seedSession(mine, 1, id);
    server.elsewhere.seedSession(theirs, 1, id);
    await db.syncState.update(SCOPE, { cursor: syncCursor(1) });

    await deleteWorkspace(db, id, context);
    await syncNow(deps);
    expect(server.sessions.get(mine.id)).toMatchObject({ workspaceId: null });
    expect(server.workspaces.get(id)).toMatchObject({ deleted: false });
    expect((await readWorkspaces(db)).workspaces).toMatchObject([{ id, deletedAt: null, sync: { state: "synced" } }]);
    expect(await listOutbox(db, SCOPE)).toEqual([]);
  });

  it("uploads a session again without its workspace when that workspace was deleted elsewhere meanwhile", async () => {
    const { db, server, deps } = await setup();
    const id = ids();
    server.elsewhere.addWorkspace(id);
    await syncedWorkspace(db, id, 1);
    const session = await syncedSession(db, 2, 1, null);
    server.elsewhere.seedSession(session, 1);
    await db.syncState.update(SCOPE, { cursor: syncCursor(1) });
    await assignSession(db, session.id, id, context);
    server.elsewhere.deleteWorkspace(id);

    expect(await syncNow(deps)).toMatchObject({ push: { status: "done", accepted: 1, rejected: 0, remaining: 0 } });
    expect(server.pushes.map((operations) => operations[0]!.payload!.workspaceId)).toEqual([id, null]);
    expect(server.sessions.get(session.id)).toMatchObject({ version: 2, workspaceId: null });
    expect(await db.sessions.get(session.id)).toMatchObject({ workspaceId: null, sync: { serverVersion: 2, state: "synced" } });
    expect(await db.workspaces.get(id)).toBeUndefined();
  });

  it("keeps a create the account refuses on the workspace, holds its sessions back, and lets the user remove it", async () => {
    const { db, server, deps } = await setup();
    server.options.refuseWorkspaceCreates = true;
    const session = await syncedSession(db, 2, 1, null);
    server.elsewhere.seedSession(session, 1);
    const { workspaceId } = await createWorkspace(db, { name: "Too many", color: null }, context);
    await assignSession(db, session.id, workspaceId, context);

    expect(await syncNow(deps)).toMatchObject({ push: { status: "done", accepted: 0, rejected: 1, remaining: 1 } });
    expect(await db.workspaces.get(workspaceId)).toMatchObject({ sync: { state: "error", lastError: "Refused: LIMIT_REACHED" } });
    expect(await readSyncOverview(db)).toMatchObject({ kind: "on", state: "review", review: 1, waiting: 1 });
    expect(server.pushes).toHaveLength(1);

    await deleteWorkspace(db, workspaceId, context);
    await syncNow(deps);
    expect(server.sessions.get(session.id)).toMatchObject({ version: 2, workspaceId: null });
    expect(await listOutbox(db, SCOPE)).toEqual([]);
    expect(await readSyncOverview(db)).toMatchObject({ state: "synced" });
  });
});

describe("workspace download", () => {
  it("bootstraps the account's workspaces and each session's workspace, dropping workspaces deleted in the account unless changes wait here", async () => {
    const { db, server, deps } = await setup({ cursor: null });
    const live = ids();
    const deleted = ids();
    server.elsewhere.addWorkspace(live, { name: "Live" });
    // Cached before v6 (workspace unknown) at the account's own version: it learns its workspace.
    const cached = await syncedSession(db, 2, 3);
    server.elsewhere.seedSession(cached, 3, live);
    await syncedWorkspace(db, deleted, 4);
    const orphan = await syncedSession(db, 3, 2, deleted);
    server.elsewhere.seedSession(orphan, 2, deleted);
    server.sessions.get(orphan.id)!.workspaceId = null;
    const { workspaceId: waiting } = await createWorkspace(db, { name: "Not uploaded yet", color: null }, context);

    expect(await pullNow(deps)).toMatchObject({ status: "done", bootstrapped: true });
    expect(await db.workspaces.get(live)).toMatchObject({ name: "Live", sync: { serverVersion: 1, state: "synced" } });
    expect(await db.workspaces.get(deleted)).toBeUndefined();
    expect((await db.sessions.get(orphan.id))?.workspaceId).toBeNull();
    expect(await db.workspaces.get(waiting)).toMatchObject({ sync: { state: "pending" } });
    expect((await db.sessions.get(cached.id))?.workspaceId).toBe(live);
    // Display order is position, then creation time: the local one was created first.
    expect((await readWorkspaces(db)).workspaces.map((workspace) => workspace.id)).toEqual([waiting, live]);
  });

  it("stores the workspace of sessions downloaded from the account", async () => {
    const { db, server, deps } = await setup({ cursor: null });
    const workspace = ids();
    const session = sampleSession({ name: "From elsewhere" }, 4);
    server.elsewhere.addWorkspace(workspace);
    server.elsewhere.seedSession(session, 1);
    server.elsewhere.assignSession(session.id, workspace);

    await pullNow(deps);
    expect(await db.sessions.get(session.id)).toMatchObject({ scope: SCOPE, workspaceId: workspace, sync: { serverVersion: 2 } });
  });
});
