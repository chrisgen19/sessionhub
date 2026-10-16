import { describe, expect, it } from "vitest";
import type { OutboxRecord, SyncStateRecord } from "./db";
import { overviewText, sessionSyncLabel, syncNowMessage, syncOverview } from "./sync-status";

const state = (overrides: Partial<SyncStateRecord> = {}): SyncStateRecord => ({
  scope: "account:Alice",
  enabledAt: "2026-10-16T08:00:00.000Z",
  cursor: null,
  lastSyncAt: "2026-10-16T09:00:00.000Z",
  lastError: null,
  failures: 0,
  nextAttemptAt: null,
  ...overrides,
});
const op = (status: OutboxRecord["status"]) => ({ status }) as OutboxRecord;

describe("sessionSyncLabel", () => {
  it("says Local only for this browser's sessions and shows the account's state otherwise", () => {
    expect(sessionSyncLabel({ scope: "local" }, true)).toBe("local");
    expect(sessionSyncLabel({ scope: "account:a", sync: { serverVersion: 3, state: "synced" } }, true)).toBe("synced");
    expect(sessionSyncLabel({ scope: "account:a", sync: { serverVersion: null, state: "pending" } }, true)).toBe("pending");
    expect(sessionSyncLabel({ scope: "account:a", sync: { serverVersion: 1, state: "conflict" } }, true)).toBe("conflict");
  });

  it("never claims waiting or synced while sync is off, but still surfaces problems", () => {
    expect(sessionSyncLabel({ scope: "account:a", sync: { serverVersion: 1, state: "pending" } }, false)).toBe("paused");
    expect(sessionSyncLabel({ scope: "account:a", sync: { serverVersion: 1, state: "synced" } }, false)).toBe("paused");
    expect(sessionSyncLabel({ scope: "account:a", sync: { serverVersion: 1, state: "error" } }, false)).toBe("error");
  });
});

describe("syncOverview", () => {
  it("separates not connected, connected with sync off, and sync on", () => {
    expect(syncOverview({ connected: false, state: state(), operations: [], localSessions: 2 })).toEqual({ kind: "local-only" });
    expect(syncOverview({ connected: true, state: undefined, operations: [], localSessions: 2 })).toEqual({ kind: "sync-off", localSessions: 2 });
    expect(syncOverview({ connected: true, state: state({ enabledAt: null }), operations: [], localSessions: 0 })).toMatchObject({ kind: "sync-off" });
    expect(syncOverview({ connected: true, state: state(), operations: [], localSessions: 1 })).toMatchObject({ kind: "on", state: "synced", lastSyncAt: "2026-10-16T09:00:00.000Z", localSessions: 1 });
  });

  it("ranks failures over review over waiting, and tells offline apart", () => {
    const operations = [op("queued"), op("sending"), op("conflict")];
    expect(syncOverview({ connected: true, state: state(), operations: [op("queued")], localSessions: 0 })).toMatchObject({ state: "pending", waiting: 1, review: 0 });
    expect(syncOverview({ connected: true, state: state(), operations, localSessions: 0 })).toMatchObject({ state: "review", waiting: 2, review: 1 });
    const failing = state({ failures: 2, lastError: "Couldn't reach SessionHub.", lastErrorCode: "NETWORK", nextAttemptAt: "2026-10-16T09:05:00.000Z" });
    expect(syncOverview({ connected: true, state: failing, operations, localSessions: 0 })).toMatchObject({ state: "offline", lastError: "Couldn't reach SessionHub.", nextAttemptAt: "2026-10-16T09:05:00.000Z" });
    expect(syncOverview({ connected: true, state: { ...failing, lastErrorCode: "INTERNAL_ERROR" }, operations, localSessions: 0 })).toMatchObject({ state: "failed" });
  });

  it("uses the labels from the UI spec", () => {
    expect(overviewText({ kind: "local-only" })).toBe("Local only");
    expect(overviewText({ kind: "sync-off", localSessions: 0 })).toBe("Sync off");
    expect(overviewText(syncOverview({ connected: true, state: state(), operations: [op("queued")], localSessions: 0 }))).toBe("Waiting to sync");
  });
});

describe("syncNowMessage", () => {
  const done = { status: "done" as const, accepted: 0, conflicts: 0, rejected: 0, remaining: 0 };
  const pulled = { status: "done" as const, applied: 0, held: 0, skipped: 0, bootstrapped: false };

  it("reports what moved, or that nothing had to", () => {
    expect(syncNowMessage({ push: done, pull: pulled })).toEqual({ tone: "ok", text: "Everything is up to date." });
    expect(syncNowMessage({ push: { ...done, accepted: 2 }, pull: { ...pulled, applied: 1 } })).toEqual({ tone: "ok", text: "Synced: uploaded 2 changes, downloaded 1 change." });
  });

  it("calls out refused changes and failures instead of claiming success", () => {
    expect(syncNowMessage({ push: { ...done, accepted: 1, conflicts: 1 }, pull: pulled })).toEqual({ tone: "error", text: "Synced: uploaded 1 change. 1 change needs review." });
    expect(syncNowMessage({ push: { status: "error", message: "Couldn't reach SessionHub.", retryAt: null }, pull: null })).toEqual({ tone: "error", text: "Sync failed: Couldn't reach SessionHub." });
    expect(syncNowMessage({ push: { status: "disabled" }, pull: null }).text).toBe("Sync is off. Turn it on first.");
  });
});
