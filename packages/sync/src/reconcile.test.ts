import { describe, expect, it } from "vitest";
import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import { reconcileHeldCopy, reconcileRemoteChange, toLocalSession, type LocalEntity } from "./reconcile";

const SCOPE = "account:alice";
const clean = (overrides: Partial<LocalEntity> = {}): LocalEntity => ({
  recordScope: SCOPE,
  serverVersion: 3,
  pendingOperations: 0,
  tombstone: false,
  serverCopyVersion: null,
  ...overrides,
});
const upsert = (version: number) => ({ action: "upsert" as const, version });
const remove = (version: number) => ({ action: "delete" as const, version });

describe("reconcileRemoteChange", () => {
  it("writes newer server state over a clean record and removes it on a newer delete", () => {
    expect(reconcileRemoteChange(SCOPE, clean(), upsert(4))).toEqual({ kind: "write" });
    expect(reconcileRemoteChange(SCOPE, clean(), remove(4))).toEqual({ kind: "remove" });
  });

  it("creates sessions it doesn't have, and ignores deletes of ones it never had", () => {
    const none = clean({ recordScope: null, serverVersion: null });
    expect(reconcileRemoteChange(SCOPE, none, upsert(1))).toEqual({ kind: "write" });
    expect(reconcileRemoteChange(SCOPE, none, remove(2))).toEqual({ kind: "skip", reason: "absent" });
  });

  it("ignores what it already has, including its own uploads coming back", () => {
    expect(reconcileRemoteChange(SCOPE, clean(), upsert(3))).toEqual({ kind: "skip", reason: "stale" });
    expect(reconcileRemoteChange(SCOPE, clean(), upsert(2))).toEqual({ kind: "skip", reason: "stale" });
  });

  it("never overwrites local changes that are waiting: it holds the newest server state instead", () => {
    const dirty = clean({ pendingOperations: 1 });
    expect(reconcileRemoteChange(SCOPE, dirty, upsert(4))).toEqual({ kind: "hold" });
    expect(reconcileRemoteChange(SCOPE, dirty, remove(5))).toEqual({ kind: "hold" });
    expect(reconcileRemoteChange(SCOPE, { ...dirty, serverCopyVersion: 6 }, upsert(5))).toEqual({ kind: "skip", reason: "stale" });
    // Conflicts and rejections count as waiting too.
    expect(reconcileRemoteChange(SCOPE, clean({ pendingOperations: 2, serverVersion: null }), upsert(1))).toEqual({ kind: "hold" });
  });

  it("never brings back a local delete; the server's delete ends the tombstone", () => {
    const deleted = clean({ recordScope: null, tombstone: true });
    expect(reconcileRemoteChange(SCOPE, deleted, upsert(9))).toEqual({ kind: "skip", reason: "tombstoned" });
    expect(reconcileRemoteChange(SCOPE, deleted, remove(4))).toEqual({ kind: "purge-tombstone" });
  });

  it("never touches a record that belongs to another scope", () => {
    for (const other of ["local", "account:bob"]) {
      expect(reconcileRemoteChange(SCOPE, clean({ recordScope: other }), upsert(99))).toEqual({ kind: "skip", reason: "other-scope" });
      expect(reconcileRemoteChange(SCOPE, clean({ recordScope: other, pendingOperations: 1 }), remove(99))).toEqual({ kind: "skip", reason: "other-scope" });
    }
  });
});

describe("reconcileHeldCopy", () => {
  it("drops a copy that isn't newer than the accepted version, ending the tombstone for an own delete", () => {
    expect(reconcileHeldCopy(upsert(5), 5, 0)).toBe("drop");
    expect(reconcileHeldCopy(remove(6), 6, 0)).toBe("drop-and-purge-tombstone");
  });

  it("applies a newer copy once nothing else is waiting, and keeps it while more changes are", () => {
    expect(reconcileHeldCopy(upsert(7), 5, 0)).toBe("apply");
    expect(reconcileHeldCopy(remove(7), 5, 0)).toBe("apply");
    expect(reconcileHeldCopy(upsert(7), 5, 1)).toBe("keep");
  });
});

describe("toLocalSession", () => {
  it("keeps the server's content and provenance and moves the local version forward", () => {
    const detail: ApiSessionDetail = {
      id: "64b7e32a-11f4-4caa-929f-0fab1139a7b0",
      name: "Research",
      description: "Web only",
      workspaceId: null,
      sourceDeviceId: "8c20b166-6156-4728-a9bc-10635ca68ca1",
      sourceDeviceName: "Chrome on Windows",
      isPinned: true,
      isArchived: false,
      version: 7,
      tabCount: 0,
      windowCount: 0,
      createdAt: "2026-10-16T08:00:00.000Z",
      updatedAt: "2026-10-16T09:00:00.000Z",
      windows: [],
    };
    expect(toLocalSession(detail, 3)).toEqual({
      id: detail.id,
      schemaVersion: 1,
      name: "Research",
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      sourceDeviceId: detail.sourceDeviceId,
      sourceDeviceName: "Chrome on Windows",
      version: 4,
      windows: [],
    });
    expect(toLocalSession(detail, null).version).toBe(1);
  });
});
