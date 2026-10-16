import { Dexie } from "dexie";
import { describe, expect, it, vi } from "vitest";
import type { CaptureWindowInput } from "@sessionhub/core/capture";
import { createSessionExport } from "@sessionhub/core/session-export";
import { handleCommand, type HandlerDeps } from "./command-handlers";
import type { RestoreTabOutcome } from "./db";
import { runCheckpoint } from "./recovery-checkpoint";
import { getRecoveryState, listSnapshots } from "./recovery-repository";
import { getSession, listSessions, putSession } from "./session-repository";
import { freshDb, idFactory, sampleSession, sampleWindows } from "./test-fixtures";

let clock = Date.parse("2026-10-16T08:00:00.000Z");
const tick = () => new Date((clock += 60_000));
const quota = () => Dexie.Promise.reject(new Dexie.QuotaExceededError("The quota has been exceeded."));

const makeDeps = (overrides: Partial<HandlerDeps> = {}): HandlerDeps => ({
  db: freshDb(),
  readWindows: vi.fn(async () => sampleWindows()),
  restoreWindow: vi.fn<HandlerDeps["restoreWindow"]>(async (window) =>
    window.tabs.map((tab): RestoreTabOutcome => ({ sourceTabId: tab.sourceTabId, status: "opened" })),
  ),
  now: tick,
  createId: idFactory(5),
  ...overrides,
});

const storageFull = (message: RegExp) => ({ ok: false, error: { code: "storage-full", message: expect.stringMatching(message) } });

describe("storage full on user actions", () => {
  it("save: explains that nothing was saved", async () => {
    const deps = makeDeps();
    vi.spyOn(deps.db.sessions, "put").mockImplementation(quota);
    const response = await handleCommand({ type: "session.capture", scope: { kind: "all-windows" } }, deps);
    expect(response).toEqual(storageFull(/^Storage for SessionHub is full, so this wasn't saved\. Delete or export/));
  });

  it("import: explains that the file wasn't imported", async () => {
    const deps = makeDeps();
    vi.spyOn(deps.db.sessions, "add").mockImplementation(quota);
    const content = JSON.stringify(createSessionExport(sampleSession(), new Date()));
    expect(await handleCommand({ type: "session.import", content }, deps)).toEqual(storageFull(/this file wasn't imported/));
  });

  it("rename: keeps the old name", async () => {
    const deps = makeDeps();
    const session = sampleSession();
    await putSession(deps.db, session);
    vi.spyOn(deps.db.sessions, "put").mockImplementation(quota);
    const response = await handleCommand({ type: "session.rename", sessionId: session.id, expectedVersion: 1, name: "New" }, deps);
    expect(response).toEqual(storageFull(/the new name wasn't saved/));
    vi.restoreAllMocks();
    expect((await getSession(deps.db, session.id))?.name).toBe(session.name);
  });

  it("restore: opens nothing when the job can't be recorded up front", async () => {
    const deps = makeDeps();
    const session = sampleSession();
    await putSession(deps.db, session);
    vi.spyOn(deps.db.restoreJobs, "add").mockImplementation(quota);
    const response = await handleCommand({ type: "restore.start", sessionId: session.id }, deps);
    expect(response).toEqual(storageFull(/couldn't start and nothing was opened/));
    expect(deps.restoreWindow).not.toHaveBeenCalled();
  });

  it("restore: stops after the first window whose outcome can't be recorded, and says tabs may have opened", async () => {
    const deps = makeDeps();
    const session = sampleSession();
    await putSession(deps.db, session);
    vi.spyOn(deps.db.restoreJobs, "put").mockImplementation(quota);
    const response = await handleCommand({ type: "restore.start", sessionId: session.id }, deps);
    expect(response).toEqual(storageFull(/couldn't record which tabs opened\. Check your new windows/));
    expect(deps.restoreWindow).toHaveBeenCalledTimes(1);
  });
});

describe("storage full during checkpoints", () => {
  const withUrl = (url: string): CaptureWindowInput[] => [
    { tabs: [{ url, title: url, pinned: false, index: 0, groupKey: null }], groups: [] },
  ];

  /** Six real checkpoints, oldest first; the newest is https://s5.test/. */
  const seeded = async () => {
    const deps = makeDeps();
    for (let index = 0; index < 6; index += 1) {
      deps.readWindows = vi.fn(async () => withUrl(`https://s${index}.test/`));
      await runCheckpoint(deps, { force: true, reason: "automatic" });
    }
    deps.readWindows = vi.fn(async () => withUrl("https://new.test/"));
    return deps;
  };
  const urls = async (deps: HandlerDeps) => (await listSnapshots(deps.db)).map((s) => s.session.windows[0]!.tabs[0]!.url);

  it("evicts older checkpoints, keeps the newest, and retries once", async () => {
    const deps = await seeded();
    const add = vi.spyOn(deps.db.recoverySnapshots, "add").mockImplementationOnce(quota);
    const result = await runCheckpoint(deps, { force: true, reason: "manual" });

    expect(result).toMatchObject({ status: "created", freedForSpace: 3 });
    expect(add).toHaveBeenCalledTimes(2);
    expect(await urls(deps)).toEqual(["https://new.test/", "https://s5.test/", "https://s4.test/", "https://s3.test/"]);
  });

  it("records a specific error and keeps the newest checkpoint when the retry also fails", async () => {
    const deps = await seeded();
    const add = vi.spyOn(deps.db.recoverySnapshots, "add").mockImplementation(quota);
    const result = await runCheckpoint(deps, { force: true, reason: "automatic" });

    expect(result).toMatchObject({ status: "error", storageFull: true, message: expect.stringMatching(/Earlier checkpoints are kept/) });
    expect(add).toHaveBeenCalledTimes(2);
    expect((await urls(deps))[0]).toBe("https://s5.test/");
    expect((await getRecoveryState(deps.db)).lastError).toMatch(/^Storage for SessionHub is full/);
  });

  it("does not retry when there is nothing safe to evict", async () => {
    const deps = makeDeps();
    await runCheckpoint(deps, { force: true, reason: "automatic" });
    deps.readWindows = vi.fn(async () => withUrl("https://other.test/"));
    const add = vi.spyOn(deps.db.recoverySnapshots, "add").mockImplementation(quota);
    expect(await runCheckpoint(deps, { force: true, reason: "automatic" })).toMatchObject({ status: "error", storageFull: true });
    expect(add).toHaveBeenCalledTimes(1);
    expect(await deps.db.recoverySnapshots.count()).toBe(1);
  });

  it("reports freed space and the storage-full code through the command", async () => {
    const deps = await seeded();
    vi.spyOn(deps.db.recoverySnapshots, "add").mockImplementationOnce(quota);
    expect(await handleCommand({ type: "recovery.checkpointNow" }, deps)).toMatchObject({
      ok: true,
      data: { status: "created", freedForSpace: 3 },
    });
    vi.spyOn(deps.db.recoverySnapshots, "add").mockImplementation(quota);
    deps.readWindows = vi.fn(async () => withUrl("https://another.test/"));
    expect(await handleCommand({ type: "recovery.checkpointNow" }, deps)).toEqual(storageFull(/checkpoint wasn't saved/));
    expect(await listSessions(deps.db)).toEqual([]);
  });
});
