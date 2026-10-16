import { Dexie } from "dexie";
import { describe, expect, it, vi } from "vitest";
import type { CaptureWindowInput } from "@sessionhub/core/capture";
import { handleCommand, type HandlerDeps } from "./command-handlers";
import { createDb, type RecoverySnapshotRecord, type RestoreTabOutcome } from "./db";
import { runCheckpoint } from "./recovery-checkpoint";
import { commitCheckpoint, getRecoveryState, listSnapshots, markRecoveryDirty } from "./recovery-repository";
import { getSession, listSessions } from "./session-repository";
import { freshDb, idFactory, sampleSession, sampleWindows } from "./test-fixtures";

let clock = Date.parse("2026-10-16T08:00:00.000Z");
const tick = () => new Date((clock += 60_000));

const makeDeps = (overrides: Partial<HandlerDeps> = {}): HandlerDeps => ({
  db: freshDb(),
  readWindows: vi.fn(async () => sampleWindows()),
  restoreWindow: vi.fn<HandlerDeps["restoreWindow"]>(async (window) => window.tabs.map((tab): RestoreTabOutcome => ({ sourceTabId: tab.sourceTabId, status: "opened" }))),
  now: tick,
  createId: idFactory(3),
  ...overrides,
});

const automatic = (deps: HandlerDeps) => runCheckpoint(deps, { force: false, reason: "automatic" });
const withUrl = (url: string): CaptureWindowInput[] => [
  { tabs: [{ url, title: url, pinned: false, index: 0, groupKey: null }], groups: [] },
];

describe("database migration", () => {
  it("upgrades a version 1 database to the current version without losing sessions", async () => {
    const name = `migration-${Date.now()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ sessions: "id, [scope+updatedAt]", device: "key", restoreJobs: "id, sessionId, createdAt" });
    const session = sampleSession();
    await v1.table("sessions").put({ ...session, scope: "local" });
    v1.close();

    const db = createDb(name);
    expect(await getSession(db, session.id)).toEqual(session);
    expect(db.verno).toBe(4);
    expect(await db.recoverySnapshots.count()).toBe(0);
    expect(await db.account.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("upgrades a version 3 database (connected, before account ids) to version 4 with an empty outbox", async () => {
    const name = `migration-v3-${Date.now()}`;
    const v3 = new Dexie(name);
    v3.version(1).stores({ sessions: "id, [scope+updatedAt]", device: "key", restoreJobs: "id, sessionId, createdAt" });
    v3.version(2).stores({ recoverySnapshots: "id, capturedAt, [capturedAt+tabCount]", recoveryState: "key" });
    v3.version(3).stores({ account: "key" });
    const session = sampleSession();
    await v3.table("sessions").put({ ...session, scope: "local" });
    const connection = { key: "connection", apiOrigin: "https://sessionhub.example", deviceId: "6f1c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f", deviceName: "Chrome on Windows", account: { name: "Pat", email: "pat@example.test" }, connectedAt: "2026-10-16T08:00:00.000Z", accessToken: "shd_at_x", refreshToken: "shd_rt_x", accessExpiresAt: "2026-10-16T08:15:00.000Z", refreshExpiresAt: "2026-11-15T08:00:00.000Z" };
    await v3.table("account").put(connection);
    v3.close();

    const db = createDb(name);
    expect(db.verno).toBe(4);
    expect(await db.account.get("connection")).toEqual(connection);
    // No account id yet, so only this browser's sessions are visible (the next account check adds it).
    expect(await listSessions(db)).toEqual([session]);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.sessionTombstones.count()).toBe(0);
    expect(await db.syncState.count()).toBe(0);
  });

  it("upgrades a version 2 database (with checkpoints) to the current version, adding an empty account table", async () => {
    const name = `migration-v2-${Date.now()}`;
    const v2 = new Dexie(name);
    v2.version(1).stores({ sessions: "id, [scope+updatedAt]", device: "key", restoreJobs: "id, sessionId, createdAt" });
    v2.version(2).stores({ recoverySnapshots: "id, capturedAt, [capturedAt+tabCount]", recoveryState: "key" });
    const session = sampleSession();
    await v2.table("sessions").put({ ...session, scope: "local" });
    await v2.table("recoveryState").put({ key: "state", dirty: true, lastChangeAt: null, lastSnapshotAt: null, lastFingerprint: null, lastError: null });
    v2.close();

    const db = createDb(name);
    expect(db.verno).toBe(4);
    expect(await getSession(db, session.id)).toEqual(session);
    expect(await db.recoveryState.get("state")).toMatchObject({ dirty: true });
    expect(await db.account.count()).toBe(0);
  });
});

describe("automatic checkpoints", () => {
  it("does nothing while clean, and flips to dirty exactly once", async () => {
    const deps = makeDeps();
    expect(await automatic(deps)).toEqual({ status: "clean" });
    expect(deps.readWindows).not.toHaveBeenCalled();
    expect(await markRecoveryDirty(deps.db, tick())).toBe(true);
    expect(await markRecoveryDirty(deps.db, tick())).toBe(false);
  });

  it("captures when dirty, then skips unchanged state and clears the flag", async () => {
    const deps = makeDeps();
    await markRecoveryDirty(deps.db, tick());
    expect(await automatic(deps)).toMatchObject({ status: "created", stillDirty: false });
    const state = await getRecoveryState(deps.db);
    expect(state).toMatchObject({ dirty: false, lastError: null });

    await markRecoveryDirty(deps.db, tick());
    expect(await automatic(deps)).toMatchObject({ status: "unchanged" });
    expect(await deps.db.recoverySnapshots.count()).toBe(1);
    expect((await getRecoveryState(deps.db)).dirty).toBe(false);

    const [snapshot] = await listSnapshots(deps.db);
    expect(snapshot).toMatchObject({ reason: "automatic", windowCount: 2, tabCount: 4 });
    expect(snapshot!.session.name).toMatch(/^Checkpoint, /);
  });

  it("stays dirty when a change arrives during capture", async () => {
    const deps = makeDeps();
    await markRecoveryDirty(deps.db, tick());
    deps.readWindows = vi.fn(async () => {
      await markRecoveryDirty(deps.db, tick());
      return sampleWindows();
    });
    expect(await automatic(deps)).toMatchObject({ status: "created", stillDirty: true });
    expect((await getRecoveryState(deps.db)).dirty).toBe(true);
  });

  it("stores nothing when no windows have tabs", async () => {
    const deps = makeDeps({ readWindows: vi.fn(async () => []) });
    await markRecoveryDirty(deps.db, tick());
    expect(await automatic(deps)).toMatchObject({ status: "empty" });
    expect(await deps.db.recoverySnapshots.count()).toBe(0);
  });

  it("records errors and clears them after the next success", async () => {
    const deps = makeDeps({ readWindows: vi.fn(async () => Promise.reject(new Error("tabs API unavailable"))) });
    await markRecoveryDirty(deps.db, tick());
    expect(await automatic(deps)).toEqual({ status: "error", message: "tabs API unavailable", storageFull: false });
    expect(await getRecoveryState(deps.db)).toMatchObject({ dirty: true, lastError: "tabs API unavailable" });

    deps.readWindows = vi.fn(async () => sampleWindows());
    expect(await automatic(deps)).toMatchObject({ status: "created" });
    expect((await getRecoveryState(deps.db)).lastError).toBeNull();
  });

  it("creates only one snapshot when two checkpoints overlap", async () => {
    const deps = makeDeps();
    await markRecoveryDirty(deps.db, tick());
    const results = await Promise.all([automatic(deps), automatic(deps)]);
    expect(results.map((r) => r.status).sort()).toEqual(["created", "unchanged"]);
    expect(await deps.db.recoverySnapshots.count()).toBe(1);
  });
});

describe("retention", () => {
  const snapshotFor = async (deps: HandlerDeps, url: string) => {
    deps.readWindows = vi.fn(async () => withUrl(url));
    return runCheckpoint(deps, { force: true, reason: "manual" });
  };

  it("bounds the number of checkpoints and keeps the newest", async () => {
    const deps = makeDeps();
    for (let index = 0; index < 55; index += 1) await snapshotFor(deps, `https://site${index}.test/`);
    const snapshots = await listSnapshots(deps.db);
    expect(snapshots).toHaveLength(50);
    expect(snapshots[0]!.session.windows[0]!.tabs[0]!.url).toBe("https://site54.test/");
  });

  it("evicts nothing when inserting the new checkpoint fails", async () => {
    const deps = makeDeps();
    for (let index = 0; index < 3; index += 1) await snapshotFor(deps, `https://keep${index}.test/`);
    const before = await getRecoveryState(deps.db);
    const [newest] = await listSnapshots(deps.db);
    const broken: RecoverySnapshotRecord = {
      ...newest!,
      id: "00000000-0000-4000-8000-00000000beef",
      capturedAt: tick().toISOString(),
      session: { ...newest!.session, name: "" },
    };
    await expect(
      commitCheckpoint(deps.db, { snapshot: broken, fingerprint: "new", startedAt: tick(), policy: { maxCount: 1, maxAgeDays: 7 } }),
    ).rejects.toThrow();
    expect(await deps.db.recoverySnapshots.count()).toBe(3);
    expect(await getRecoveryState(deps.db)).toEqual(before);
  });
});

describe("recovery commands", () => {
  it("takes a checkpoint on demand and restores it through the normal restore flow", async () => {
    const deps = makeDeps();
    const created = await handleCommand({ type: "recovery.checkpointNow" }, deps);
    expect(created).toMatchObject({ ok: true, data: { status: "created" } });
    expect(await handleCommand({ type: "recovery.checkpointNow" }, deps)).toMatchObject({ ok: true, data: { status: "unchanged", snapshotId: null } });

    const snapshotId = created.ok ? (created.data as { snapshotId: string }).snapshotId : "";
    const restored = await handleCommand({ type: "recovery.restore", snapshotId }, deps);
    expect(restored).toMatchObject({ ok: true, data: { job: { status: "completed", sessionId: snapshotId } } });
    expect(deps.restoreWindow).toHaveBeenCalledTimes(2);
  });

  it("returns not-found for a checkpoint removed by retention", async () => {
    const deps = makeDeps();
    expect(
      await handleCommand({ type: "recovery.restore", snapshotId: "00000000-0000-4000-8000-0000000000cc" }, deps),
    ).toMatchObject({ ok: false, error: { code: "not-found" } });
  });
});
