import { describe, expect, it, vi } from "vitest";
import type { CaptureWindowInput } from "@sessionhub/core/capture";
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
});
