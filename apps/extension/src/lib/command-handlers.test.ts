import { describe, expect, it, vi } from "vitest";
import type { CaptureWindowInput } from "@sessionhub/core/capture";
import { createSessionExport } from "@sessionhub/core/session-export";
import { handleCommand, BrowserError, type HandlerDeps } from "./command-handlers";
import type { RestoreJobRecord } from "./db";
import type { RestoreTabOutcome } from "./db";
import { settleInterruptedJobs } from "./restore-job-repository";
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

  it("saves only the tabs ticked in the picker, with its name, and reports ticked tabs that closed", async () => {
    const deps = makeDeps({ readWindows: vi.fn(async () => sampleWindows().slice(0, 1)) });
    const response = await handleCommand({ type: "session.capture", scope: { kind: "tabs", tabIds: [3, 4, 4, 99] }, name: "  Picked tabs " }, deps);
    expect(response).toMatchObject({ ok: true, data: { syncing: false, missing: 0, report: { tabCount: 3, windowCount: 1 } } });
    expect(deps.readWindows).toHaveBeenCalledWith({ kind: "tabs", tabIds: [3, 4, 4, 99] });
    const sessionId = response.ok ? (response.data as { sessionId: string }).sessionId : "";
    expect((await getSession(deps.db, sessionId))?.name).toBe("Picked tabs");

    // Three distinct ids ticked, one tab still open: two had closed.
    const oneLeft = makeDeps({ readWindows: async () => [{ tabs: [{ url: "https://a.test/", title: "A", pinned: false, index: 0, groupKey: null }], groups: [] }] });
    const partial = await handleCommand({ type: "session.capture", scope: { kind: "tabs", tabIds: [1, 2, 3] } }, oneLeft);
    expect(partial).toMatchObject({ ok: true, data: { missing: 2, report: { tabCount: 1 } } });
    expect((await listSessions(oneLeft.db))[0]?.name).toMatch(/^Window, /);
  });

  it("refuses a bad name before reading the browser, and says so when every ticked tab closed", async () => {
    const deps = makeDeps();
    const blank = await handleCommand({ type: "session.capture", scope: { kind: "tabs", tabIds: [1] }, name: "   " }, deps);
    expect(blank).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(deps.readWindows).not.toHaveBeenCalled();
    const gone = await handleCommand({ type: "session.capture", scope: { kind: "tabs", tabIds: [1] } }, makeDeps({ readWindows: async () => [] }));
    expect(gone).toMatchObject({ ok: false, error: { code: "browser-error", message: "The tabs you chose were closed before saving" } });
    expect(await handleCommand({ type: "session.capture", scope: { kind: "tabs", tabIds: [] } }, deps)).toMatchObject({ ok: false, error: { code: "invalid-command" } });
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

  it("settles the job as failed (and so retryable) when a restore step throws", async () => {
    const deps = makeDeps({ restoreWindow: vi.fn(async () => Promise.reject(new Error("worker stopped"))) });
    const { sessionId } = await capture(deps);
    expect(await handleCommand({ type: "restore.start", sessionId }, deps)).toMatchObject({ ok: false });
    const jobs = await deps.db.restoreJobs.toArray();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "failed", outcomes: [] });
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

  describe("restore.retry", () => {
    const openFirstTabOnly: HandlerDeps["restoreWindow"] = async (window) =>
      window.tabs.map((tab, index): RestoreTabOutcome =>
        index === 0 ? { sourceTabId: tab.sourceTabId, status: "opened" } : { sourceTabId: tab.sourceTabId, status: "failed", error: "No window with id: 9" },
      );
    const openAll: HandlerDeps["restoreWindow"] = async (window) =>
      window.tabs.map((tab): RestoreTabOutcome => ({ sourceTabId: tab.sourceTabId, status: "opened" }));

    /** Captures, then runs a first restore where only the first tab of each window opens. */
    const partialRestore = async () => {
      const deps = makeDeps({ restoreWindow: vi.fn(openFirstTabOnly) });
      const { sessionId } = await capture(deps);
      const response = await handleCommand({ type: "restore.start", sessionId }, deps);
      if (!response.ok) throw new Error(response.error.message);
      return { deps, sessionId, job: (response.data as { job: RestoreJobRecord }).job };
    };

    const tabsPassedTo = (fn: HandlerDeps["restoreWindow"]) =>
      vi.mocked(fn).mock.calls.flatMap(([window]) => window.tabs.map((tab) => tab.sourceTabId));

    it("reopens only tabs that failed and never ones that already opened", async () => {
      const { deps, job } = await partialRestore();
      expect(job.status).toBe("partial");
      const alreadyOpened = job.outcomes.filter((o) => o.status === "opened").map((o) => o.sourceTabId);
      const failed = job.outcomes.filter((o) => o.status === "failed").map((o) => o.sourceTabId);

      deps.restoreWindow = vi.fn(openAll);
      const response = await handleCommand({ type: "restore.retry", jobId: job.id }, deps);
      expect(response).toMatchObject({ ok: true, data: { job: { status: "completed", attempts: 2 } } });
      expect(tabsPassedTo(deps.restoreWindow)).toEqual(failed);
      expect(tabsPassedTo(deps.restoreWindow).some((id) => alreadyOpened.includes(id))).toBe(false);
      expect(await deps.db.restoreJobs.get(job.id)).toMatchObject({ status: "completed", attempts: 2 });
    });

    it("stays partial when the retry fails again and can be retried once more", async () => {
      const { deps, job } = await partialRestore();
      deps.restoreWindow = vi.fn<HandlerDeps["restoreWindow"]>(async (window) =>
        window.tabs.map((tab): RestoreTabOutcome => ({ sourceTabId: tab.sourceTabId, status: "failed", error: "still closed" })),
      );
      expect(await handleCommand({ type: "restore.retry", jobId: job.id }, deps)).toMatchObject({
        ok: true,
        data: { job: { status: "partial", attempts: 2 } },
      });
      deps.restoreWindow = vi.fn(openAll);
      expect(await handleCommand({ type: "restore.retry", jobId: job.id }, deps)).toMatchObject({
        ok: true,
        data: { job: { status: "completed", attempts: 3 } },
      });
    });

    it("lets only one of two concurrent retries run", async () => {
      const { deps, job } = await partialRestore();
      deps.restoreWindow = vi.fn<HandlerDeps["restoreWindow"]>(async (window, record) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return openAll(window, record);
      });
      const results = await Promise.all([
        handleCommand({ type: "restore.retry", jobId: job.id }, deps),
        handleCommand({ type: "restore.retry", jobId: job.id }, deps),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toMatchObject({ error: { code: "conflict" } });
      const failedCount = job.outcomes.filter((o) => o.status === "failed").length;
      expect(tabsPassedTo(deps.restoreWindow)).toHaveLength(failedCount);
    });

    it("refuses completed, unknown and malformed jobs", async () => {
      const deps = makeDeps();
      const { sessionId } = await capture(deps);
      const done = await handleCommand({ type: "restore.start", sessionId }, deps);
      const jobId = done.ok ? (done.data as { job: RestoreJobRecord }).job.id : "";
      expect(await handleCommand({ type: "restore.retry", jobId }, deps)).toMatchObject({ ok: false, error: { code: "conflict" } });
      expect(
        await handleCommand({ type: "restore.retry", jobId: "00000000-0000-4000-8000-0000000000aa" }, deps),
      ).toMatchObject({ ok: false, error: { code: "not-found" } });
      expect(await handleCommand({ type: "restore.retry", jobId: "x" }, deps)).toMatchObject({ ok: false, error: { code: "invalid-command" } });
    });

    it("never reopens tabs that opened before the worker was cut off mid-window", async () => {
      const deps = makeDeps();
      const { sessionId } = await capture(deps);
      // The worker dies after the first two tabs of the first window open: restoreWindow never returns.
      const cutOff = new Promise<void>((resolve) => {
        deps.restoreWindow = vi.fn<HandlerDeps["restoreWindow"]>(async (window, record) => {
          for (const tab of window.tabs.slice(0, 2)) await record?.({ sourceTabId: tab.sourceTabId, status: "opened" });
          resolve();
          return new Promise<never>(() => undefined);
        });
      });
      void handleCommand({ type: "restore.start", sessionId }, deps);
      await cutOff;
      const [running] = await deps.db.restoreJobs.toArray();
      const plannedIds = running!.plan.windows.flatMap((window) => window.tabs.map((tab) => tab.sourceTabId));

      // The next worker settles the job from what was recorded, then the user retries.
      const nextWorker = new Date("2026-10-16T09:00:00.000Z");
      await settleInterruptedJobs(deps.db, nextWorker, nextWorker);
      expect(await deps.db.restoreJobs.get(running!.id)).toMatchObject({ status: "partial", interruptedAt: nextWorker.toISOString() });
      deps.restoreWindow = vi.fn(openAll);
      await handleCommand({ type: "restore.retry", jobId: running!.id }, deps);
      expect(tabsPassedTo(deps.restoreWindow)).toEqual(plannedIds.slice(2));
    });

    it("retries every tab of a run that failed outright, even after the session is deleted", async () => {
      const deps = makeDeps({ restoreWindow: vi.fn(async () => Promise.reject(new Error("worker stopped"))) });
      const { sessionId } = await capture(deps);
      await handleCommand({ type: "restore.start", sessionId }, deps);
      const [job] = await deps.db.restoreJobs.toArray();
      await handleCommand({ type: "session.delete", sessionId }, deps);

      deps.restoreWindow = vi.fn(openAll);
      expect(await handleCommand({ type: "restore.retry", jobId: job!.id }, deps)).toMatchObject({
        ok: true,
        data: { job: { status: "completed" } },
      });
      expect(tabsPassedTo(deps.restoreWindow)).toHaveLength(job!.plan.tabCount);
    });
  });
});

describe("restore targets", () => {
  const urlsPassedTo = (fn: HandlerDeps["restoreWindow"]) =>
    vi.mocked(fn).mock.calls.map(([window]) => window.tabs.map((tab) => tab.url));
  const optionsPassedTo = (fn: HandlerDeps["restoreWindow"]) => vi.mocked(fn).mock.calls.map(([, , options]) => options);
  const start = async (deps: HandlerDeps, target: Record<string, unknown> | undefined) => {
    const { sessionId } = await capture(deps);
    return handleCommand({ type: "restore.start", sessionId, ...(target ? { target } : {}) }, deps);
  };
  const jobOf = (response: Awaited<ReturnType<typeof handleCommand>>) => {
    if (!response.ok) throw new Error(response.error.message);
    return (response.data as { job: RestoreJobRecord }).job;
  };

  it("opens new windows by default and records that", async () => {
    const deps = makeDeps();
    const job = jobOf(await start(deps, undefined));
    expect(urlsPassedTo(deps.restoreWindow)).toEqual([["https://github.com/acme/pull/42", "https://react.dev/learn"], ["https://example.com/"]]);
    expect(optionsPassedTo(deps.restoreWindow)).toEqual([{ into: undefined }, { into: undefined }]);
    expect(job.target).toBe("new-windows");
  });

  it("puts every window's tabs in one new window", async () => {
    const deps = makeDeps();
    const job = jobOf(await start(deps, { kind: "one-window" }));
    expect(urlsPassedTo(deps.restoreWindow)).toEqual([["https://github.com/acme/pull/42", "https://react.dev/learn", "https://example.com/"]]);
    expect(optionsPassedTo(deps.restoreWindow)).toEqual([{ into: undefined }]);
    expect(job).toMatchObject({ target: "one-window", status: "completed" });
  });

  it("appends to the current window, skipping tabs already open there, and never stores the window id", async () => {
    const inspectWindow = vi.fn(async () => ({ openUrls: ["https://react.dev/learn", "https://other.test/"] }));
    const deps = makeDeps({ inspectWindow });
    const job = jobOf(await start(deps, { kind: "this-window", windowId: 987654, skipOpen: true }));

    expect(inspectWindow).toHaveBeenCalledWith(987654);
    expect(urlsPassedTo(deps.restoreWindow)).toEqual([["https://github.com/acme/pull/42", "https://example.com/"]]);
    expect(optionsPassedTo(deps.restoreWindow)).toEqual([{ into: 987654 }]);
    expect(job).toMatchObject({ target: "this-window", status: "completed", plan: { tabCount: 2 } });
    expect(job.plan.alreadyOpen?.map((tab) => tab.url)).toEqual(["https://react.dev/learn"]);
    expect(JSON.stringify(await deps.db.restoreJobs.get(job.id))).not.toContain("987654");
  });

  it("opens every chosen tab in the current window when asked not to skip open ones", async () => {
    const deps = makeDeps({ inspectWindow: async () => ({ openUrls: ["https://react.dev/learn"] }) });
    const job = jobOf(await start(deps, { kind: "this-window", windowId: 42, skipOpen: false }));
    expect(urlsPassedTo(deps.restoreWindow)).toEqual([["https://github.com/acme/pull/42", "https://react.dev/learn", "https://example.com/"]]);
    expect(job.plan.alreadyOpen).toBeUndefined();
  });

  it("opens nothing and creates no job when the window can't take tabs", async () => {
    for (const overrides of [
      { inspectWindow: async () => Promise.reject(new BrowserError("That window is no longer open, so nothing was opened")) },
      {},
    ] satisfies Partial<HandlerDeps>[]) {
      const deps = makeDeps(overrides);
      expect(await start(deps, { kind: "this-window", windowId: 42, skipOpen: true })).toMatchObject({ ok: false, error: { code: "browser-error" } });
      expect(deps.restoreWindow).not.toHaveBeenCalled();
      expect(await deps.db.restoreJobs.count()).toBe(0);
    }
  });

  it("settles as completed without opening anything when every tab is already open", async () => {
    const deps = makeDeps({ inspectWindow: async () => ({ openUrls: ["https://github.com/acme/pull/42", "https://react.dev/learn", "https://example.com/"] }) });
    const job = jobOf(await start(deps, { kind: "this-window", windowId: 42, skipOpen: true }));
    expect(deps.restoreWindow).not.toHaveBeenCalled();
    expect(job).toMatchObject({ status: "completed", plan: { tabCount: 0, windows: [] } });
    expect(job.plan.alreadyOpen).toHaveLength(3);
  });

  it("retries a current-window restore in a new window, without the tabs that were already open", async () => {
    const deps = makeDeps({
      inspectWindow: async () => ({ openUrls: ["https://example.com/"] }),
      restoreWindow: vi.fn<HandlerDeps["restoreWindow"]>(async (window) =>
        window.tabs.map((tab): RestoreTabOutcome => ({ sourceTabId: tab.sourceTabId, status: "failed", error: "No window with id: 42" })),
      ),
    });
    const job = jobOf(await start(deps, { kind: "this-window", windowId: 42, skipOpen: true }));
    expect(job.status).toBe("failed");

    deps.restoreWindow = vi.fn<HandlerDeps["restoreWindow"]>(async (window) =>
      window.tabs.map((tab): RestoreTabOutcome => ({ sourceTabId: tab.sourceTabId, status: "opened" })),
    );
    expect(await handleCommand({ type: "restore.retry", jobId: job.id }, deps)).toMatchObject({ ok: true, data: { job: { status: "completed" } } });
    expect(urlsPassedTo(deps.restoreWindow)).toEqual([["https://github.com/acme/pull/42", "https://react.dev/learn"]]);
    expect(optionsPassedTo(deps.restoreWindow)).toEqual([{ into: undefined }]);
  });

  it("rejects a malformed target", async () => {
    const deps = makeDeps();
    for (const target of [{ kind: "replace-window" }, { kind: "this-window", skipOpen: true }, { kind: "this-window", windowId: "42", skipOpen: true }]) {
      expect(await start(deps, target)).toMatchObject({ ok: false, error: { code: "invalid-command" } });
    }
  });
});
