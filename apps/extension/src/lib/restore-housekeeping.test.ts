import { describe, expect, it } from "vitest";
import { planRestore } from "@sessionhub/core/restore-plan";
import type { RestoreJobRecord, RestoreTabOutcome } from "./db";
import {
  getLatestRestoreJob,
  pruneRestoreJobs,
  runRestoreHousekeeping,
  selectJobsToPrune,
  settleInterruptedJobs,
} from "./restore-job-repository";
import { freshDb, sampleSession } from "./test-fixtures";

const plan = planRestore(sampleSession());
const tabIds = plan.windows.flatMap((window) => window.tabs.map((tab) => tab.sourceTabId));
const opened = (ids: string[]): RestoreTabOutcome[] => ids.map((sourceTabId) => ({ sourceTabId, status: "opened" }));

const job = (id: string, overrides: Partial<RestoreJobRecord> = {}): RestoreJobRecord => ({
  id,
  sessionId: plan.sessionId,
  createdAt: "2026-10-16T08:00:00.000Z",
  updatedAt: "2026-10-16T08:00:00.000Z",
  status: "running",
  plan,
  outcomes: [],
  attempts: 1,
  ...overrides,
});

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

describe("settleInterruptedJobs", () => {
  const workerStartedAt = new Date("2026-10-16T09:00:00.000Z");
  const now = new Date("2026-10-16T09:00:01.000Z");

  it("settles running jobs from before this worker started, from their outcomes", async () => {
    const db = freshDb();
    await db.restoreJobs.bulkAdd([
      job(uuid(1)),
      job(uuid(2), { outcomes: opened(tabIds.slice(0, 1)) }),
      job(uuid(3), { outcomes: opened(tabIds) }),
      job(uuid(4), { status: "partial", outcomes: opened(tabIds.slice(0, 1)) }),
    ]);
    expect(await settleInterruptedJobs(db, workerStartedAt, now)).toBe(3);

    const byId = Object.fromEntries((await db.restoreJobs.toArray()).map((j) => [j.id, j]));
    expect(byId[uuid(1)]).toMatchObject({ status: "failed", interruptedAt: now.toISOString() });
    expect(byId[uuid(2)]).toMatchObject({ status: "partial", interruptedAt: now.toISOString() });
    expect(byId[uuid(3)]).toMatchObject({ status: "completed", interruptedAt: now.toISOString() });
    expect(byId[uuid(4)]!.interruptedAt).toBeUndefined();
  });

  it("leaves jobs started by this worker alone, even in the same millisecond", async () => {
    const db = freshDb();
    await db.restoreJobs.bulkAdd([
      job(uuid(1), { updatedAt: workerStartedAt.toISOString() }),
      job(uuid(2), { updatedAt: "2026-10-16T09:00:00.500Z" }),
    ]);
    expect(await settleInterruptedJobs(db, workerStartedAt, now)).toBe(0);
    expect((await db.restoreJobs.toArray()).every((j) => j.status === "running")).toBe(true);
  });
});

describe("pruning", () => {
  const now = new Date("2026-10-16T12:00:00.000Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  it("keeps the newest maxCount within maxAgeDays and always the newest job", () => {
    const jobs = [0, 1, 2, 3, 40, 41].map((days, i) => ({ id: `j${i}`, createdAt: daysAgo(days) }));
    expect(selectJobsToPrune(jobs, now, { maxCount: 3, maxAgeDays: 30 }).sort()).toEqual(["j3", "j4", "j5"]);
    expect(selectJobsToPrune([{ id: "old", createdAt: daysAgo(400) }], now)).toEqual([]);
  });

  it("deletes pruned jobs but never a running one", async () => {
    const db = freshDb();
    await db.restoreJobs.bulkAdd([
      job(uuid(1), { createdAt: daysAgo(0), status: "completed" }),
      job(uuid(2), { createdAt: daysAgo(60), status: "completed" }),
      job(uuid(3), { createdAt: daysAgo(61), status: "running" }),
    ]);
    expect(await pruneRestoreJobs(db, now)).toBe(1);
    expect((await db.restoreJobs.toArray()).map((j) => j.id).sort()).toEqual([uuid(1), uuid(3)]);
  });

  it("bounds the table at 50 jobs", async () => {
    const db = freshDb();
    await db.restoreJobs.bulkAdd(
      Array.from({ length: 60 }, (_, i) => job(uuid(i + 1), { createdAt: new Date(now.getTime() - i * 60_000).toISOString(), status: "completed" })),
    );
    expect(await pruneRestoreJobs(db, now)).toBe(10);
    expect(await db.restoreJobs.count()).toBe(50);
  });
});

describe("getLatestRestoreJob and housekeeping", () => {
  it("returns the newest job for a source", async () => {
    const db = freshDb();
    await db.restoreJobs.bulkAdd([
      job(uuid(1), { createdAt: "2026-10-16T08:00:00.000Z" }),
      job(uuid(2), { createdAt: "2026-10-16T10:00:00.000Z" }),
      job(uuid(3), { createdAt: "2026-10-16T11:00:00.000Z", sessionId: uuid(99) }),
    ]);
    expect((await getLatestRestoreJob(db, plan.sessionId))?.id).toBe(uuid(2));
    expect(await getLatestRestoreJob(db, uuid(98))).toBeUndefined();
  });

  it("settles then prunes, and never throws", async () => {
    const db = freshDb();
    await db.restoreJobs.add(job(uuid(1)));
    const now = new Date("2026-10-16T09:00:00.000Z");
    expect(await runRestoreHousekeeping(db, now, now)).toEqual({ settled: 1, pruned: 0 });
    db.close();
    await expect(runRestoreHousekeeping(db, now, now)).resolves.toEqual({ settled: 0, pruned: 0 });
  });
});
