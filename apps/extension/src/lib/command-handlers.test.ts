import { describe, expect, it, vi } from "vitest";
import type { CaptureWindowInput } from "@sessionhub/core/capture";
import { createSessionExport } from "@sessionhub/core/session-export";
import { handleCommand, BrowserError, type HandlerDeps } from "./command-handlers";
import type { RestoreTabOutcome } from "./db";
import { getSession, listSessions } from "./session-repository";
import { freshDb, idFactory, sampleWindows } from "./test-fixtures";

const makeDeps = (overrides: Partial<HandlerDeps> = {}): HandlerDeps => ({
  db: freshDb(),
  readWindows: vi.fn(async () => sampleWindows()),
  restoreWindow: vi.fn<HandlerDeps["restoreWindow"]>(async (window) =>
    window.tabs.map((tab): RestoreTabOutcome => ({ sourceTabId: tab.sourceTabId, status: "opened" })),
  ),
  now: () => new Date("2026-10-16T08:00:00.000Z"),
  createId: idFactory(7),
  ...overrides,
});

const capture = async (deps: HandlerDeps) => {
  const response = await handleCommand({ type: "session.capture", scope: { kind: "all-windows" } }, deps);
  if (!response.ok) throw new Error(response.error.message);
  return response.data as { sessionId: string };
};

describe("handleCommand", () => {
  it("rejects malformed and unknown commands", async () => {
    const deps = makeDeps();
    for (const message of [null, "x", { type: "tabs.closeAll" }, { type: "session.delete", sessionId: "nope" }]) {
      expect(await handleCommand(message, deps)).toMatchObject({ ok: false, error: { code: "invalid-command" } });
    }
  });

  it("captures windows into a local session with a stable device identity", async () => {
    const deps = makeDeps();
    const first = await capture(deps);
    const second = await capture(deps);
    const sessions = await listSessions(deps.db);
    expect(sessions).toHaveLength(2);
    expect(new Set(sessions.map((session) => session.sourceDeviceId)).size).toBe(1);
    const saved = await getSession(deps.db, first.sessionId);
    expect(saved?.name).toMatch(/^All windows, /);
    expect(saved?.windows.map((window) => window.tabs.length)).toEqual([3, 1]);
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it("stores nothing when capture fails", async () => {
    const tooMany: CaptureWindowInput[] = [
      { tabs: Array.from({ length: 2001 }, (_, index) => ({ url: "https://a.test", title: "a", pinned: false, index, groupKey: null })), groups: [] },
    ];
    const cases: [Partial<HandlerDeps>, string][] = [
      [{ readWindows: async () => tooMany }, "invalid-input"],
      [{ readWindows: async () => [] }, "browser-error"],
      [{ readWindows: async () => Promise.reject(new BrowserError("That window is no longer open")) }, "browser-error"],
    ];
    for (const [overrides, code] of cases) {
      const deps = makeDeps(overrides);
      const response = await handleCommand({ type: "session.capture", scope: { kind: "window", windowId: 1 } }, deps);
      expect(response).toMatchObject({ ok: false, error: { code } });
      expect(await listSessions(deps.db)).toEqual([]);
    }
  });

  it("renames with version checks", async () => {
    const deps = makeDeps();
    const { sessionId } = await capture(deps);
    const rename = (name: string, expectedVersion: number) =>
      handleCommand({ type: "session.rename", sessionId, name, expectedVersion }, deps);

    expect(await rename("Sprint review", 1)).toEqual({ ok: true, data: { version: 2 } });
    expect(await rename("Stale edit", 1)).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(await rename("   ", 2)).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect((await getSession(deps.db, sessionId))?.name).toBe("Sprint review");
  });

  it("deletes a session", async () => {
    const deps = makeDeps();
    const { sessionId } = await capture(deps);
    expect(await handleCommand({ type: "session.delete", sessionId }, deps)).toEqual({ ok: true, data: {} });
    expect(await listSessions(deps.db)).toEqual([]);
  });

  it("restores restorable tabs into new windows and records the job", async () => {
    const deps = makeDeps();
    const { sessionId } = await capture(deps);
    const response = await handleCommand({ type: "restore.start", sessionId }, deps);
    if (!response.ok) throw new Error(response.error.message);
    const { job } = response.data as { job: { id: string; status: string; outcomes: unknown[]; plan: { skipped: unknown[] } } };

    expect(deps.restoreWindow).toHaveBeenCalledTimes(2);
    expect(job.status).toBe("completed");
    expect(job.outcomes).toHaveLength(3);
    expect(job.plan.skipped).toHaveLength(1);
    expect(await deps.db.restoreJobs.get(job.id)).toMatchObject({ status: "completed" });
  });

  it("marks partial restores and restores only selected tabs", async () => {
    const deps = makeDeps({
      restoreWindow: vi.fn<HandlerDeps["restoreWindow"]>(async (window) =>
        window.tabs.map((tab, index): RestoreTabOutcome =>
          index === 0 ? { sourceTabId: tab.sourceTabId, status: "opened" } : { sourceTabId: tab.sourceTabId, status: "failed", error: "boom" },
        ),
      ),
    });
    const { sessionId } = await capture(deps);
    const session = await getSession(deps.db, sessionId);
    const firstWindowTabIds = session!.windows[0]!.tabs.map((tab) => tab.id);

    const response = await handleCommand({ type: "restore.start", sessionId, tabIds: firstWindowTabIds }, deps);
    expect(response).toMatchObject({ ok: true, data: { job: { status: "partial" } } });
    expect(deps.restoreWindow).toHaveBeenCalledTimes(1);
  });

  it("keeps an inspectable job record when a restore is interrupted", async () => {
    const deps = makeDeps({ restoreWindow: vi.fn(async () => Promise.reject(new Error("worker stopped"))) });
    const { sessionId } = await capture(deps);
    expect(await handleCommand({ type: "restore.start", sessionId }, deps)).toMatchObject({ ok: false });
    const jobs = await deps.db.restoreJobs.toArray();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "running", outcomes: [] });
  });

  it("returns not-found when restoring a deleted session", async () => {
    const deps = makeDeps();
    const response = await handleCommand({ type: "restore.start", sessionId: "00000000-0000-4000-8000-00000000abcd" }, deps);
    expect(response).toMatchObject({ ok: false, error: { code: "not-found" } });
  });

  describe("session.import", () => {
    const exportOf = async (deps: HandlerDeps, sessionId: string) =>
      JSON.stringify(createSessionExport((await getSession(deps.db, sessionId))!, new Date("2026-10-16T09:00:00.000Z")));

    it("imports an export as a new session and leaves the original untouched", async () => {
      const deps = makeDeps();
      const { sessionId } = await capture(deps);
      const original = await getSession(deps.db, sessionId);
      const content = await exportOf(deps, sessionId);

      const first = await handleCommand({ type: "session.import", content }, deps);
      const second = await handleCommand({ type: "session.import", content }, deps);
      expect(first).toMatchObject({ ok: true, data: { report: { windowCount: 2, tabCount: 4, reclassifiedCount: 0 } } });
      expect(second).toMatchObject({ ok: true });

      const sessions = await listSessions(deps.db);
      expect(sessions).toHaveLength(3);
      expect(new Set(sessions.map((session) => session.id)).size).toBe(3);
      expect(await getSession(deps.db, sessionId)).toEqual(original);
      const imported = sessions.find((session) => first.ok && session.id === (first.data as { sessionId: string }).sessionId);
      expect(imported).toMatchObject({ sourceDeviceId: null, version: 1, name: original!.name });
    });

    it("stores tampered unsafe urls as not restorable", async () => {
      const deps = makeDeps();
      const { sessionId } = await capture(deps);
      const file = JSON.parse(await exportOf(deps, sessionId));
      file.session.windows[1].tabs[0].url = "javascript:alert(1)";
      file.session.windows[1].tabs[0].eligibility = "restorable";
      const response = await handleCommand({ type: "session.import", content: JSON.stringify(file) }, deps);
      if (!response.ok) throw new Error(response.error.message);
      const imported = await getSession(deps.db, (response.data as { sessionId: string }).sessionId);
      expect(imported!.windows[1]!.tabs[0]!.eligibility).toBe("unsafe");
    });

    it("rejects invalid files with a readable error and writes nothing", async () => {
      const deps = makeDeps();
      for (const content of ["{", "[]", JSON.stringify({ format: "sessionhub.session-export", schemaVersion: 9 })]) {
        const response = await handleCommand({ type: "session.import", content }, deps);
        expect(response).toMatchObject({ ok: false, error: { code: "invalid-input" } });
        expect(response.ok ? "" : response.error.message.length).toBeGreaterThan(10);
      }
      expect(await listSessions(deps.db)).toEqual([]);
    });

    it("never overwrites an existing session, even on an id collision", async () => {
      const deps = makeDeps();
      const { sessionId } = await capture(deps);
      const original = await getSession(deps.db, sessionId);
      const content = await exportOf(deps, sessionId);
      // Child ids stay unique; only the final id (the session's own key) collides.
      const childIdCount = original!.windows.reduce((sum, window) => sum + 1 + window.groups.length + window.tabs.length, 0);
      const fresh = idFactory(9);
      let calls = 0;
      const colliding = makeDeps({ db: deps.db, createId: () => (++calls > childIdCount ? sessionId : fresh()) });
      const response = await handleCommand({ type: "session.import", content }, colliding);
      expect(response).toMatchObject({ ok: false, error: { code: "conflict" } });
      expect(await listSessions(deps.db)).toEqual([original]);
    });
  });
});
