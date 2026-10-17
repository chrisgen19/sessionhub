import type { RestorePlan } from "@sessionhub/core/restore-plan";
import type { RestoreJobRecord, RestoreTabOutcome, SessionHubDb } from "./db";

export class RestoreJobNotFoundError extends Error {
  override name = "RestoreJobNotFoundError";
}

export class RestoreJobNotRetryableError extends Error {
  override name = "RestoreJobNotRetryableError";
}

/** Persists the plan before any tab is opened so an interrupted restore is inspectable later. */
export const createRestoreJob = async (
  db: SessionHubDb,
  input: { id: string; plan: RestorePlan; now: Date },
): Promise<RestoreJobRecord> => {
  const timestamp = input.now.toISOString();
  const job: RestoreJobRecord = {
    id: input.id,
    sessionId: input.plan.sessionId,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "running",
    plan: input.plan,
    outcomes: [],
    attempts: 1,
  };
  await db.restoreJobs.add(job);
  return job;
};

/** Ids of planned tabs that opened in any attempt. These must never be opened again. */
export const openedTabIds = (job: RestoreJobRecord): Set<string> =>
  new Set(job.outcomes.filter((outcome) => outcome.status === "opened").map((outcome) => outcome.sourceTabId));

export interface RestoreJobSummary {
  openedCount: number;
  /** Latest failure for each tab that has not opened in any attempt. */
  failed: Extract<RestoreTabOutcome, { status: "failed" }>[];
  /** Planned tabs with no outcome at all (the run was interrupted before reaching them). */
  notAttemptedCount: number;
}

export const summarizeRestoreJob = (job: RestoreJobRecord): RestoreJobSummary => {
  const opened = openedTabIds(job);
  const latestFailure = new Map<string, Extract<RestoreTabOutcome, { status: "failed" }>>();
  for (const outcome of job.outcomes) {
    if (outcome.status === "failed" && !opened.has(outcome.sourceTabId)) latestFailure.set(outcome.sourceTabId, outcome);
  }
  const plannedIds = job.plan.windows.flatMap((window) => window.tabs.map((tab) => tab.sourceTabId));
  return {
    openedCount: plannedIds.filter((id) => opened.has(id)).length,
    failed: [...latestFailure.values()],
    notAttemptedCount: plannedIds.filter((id) => !opened.has(id) && !latestFailure.has(id)).length,
  };
};

/** Appends outcomes as the restore progresses (one write per tab as it opens). */
export const appendRestoreOutcomes = async (
  db: SessionHubDb,
  jobId: string,
  outcomes: RestoreTabOutcome[],
  now: Date,
): Promise<void> => {
  await db.transaction("rw", db.restoreJobs, async () => {
    const job = await db.restoreJobs.get(jobId);
    if (!job) return;
    await db.restoreJobs.put({ ...job, outcomes: [...job.outcomes, ...outcomes], updatedAt: now.toISOString() });
  });
};

/**
 * Compare-and-set: moves a `partial` or `failed` job back to `running` in one
 * transaction, so two concurrent retries can't both open the same tabs.
 */
export const claimRestoreJobForRetry = async (db: SessionHubDb, jobId: string, now: Date): Promise<RestoreJobRecord> =>
  db.transaction("rw", db.restoreJobs, async () => {
    const job = await db.restoreJobs.get(jobId);
    if (!job) throw new RestoreJobNotFoundError("This restore is no longer available");
    if (job.status === "running") throw new RestoreJobNotRetryableError("This restore is already running");
    if (job.status === "completed") throw new RestoreJobNotRetryableError("Every tab in this restore already opened");
    const claimed: RestoreJobRecord = {
      ...job,
      status: "running",
      attempts: (job.attempts ?? 1) + 1,
      updatedAt: now.toISOString(),
    };
    await db.restoreJobs.put(claimed);
    return claimed;
  });

const settledStatus = (job: RestoreJobRecord): RestoreJobRecord["status"] => {
  const { openedCount } = summarizeRestoreJob(job);
  return openedCount === job.plan.tabCount ? "completed" : openedCount === 0 ? "failed" : "partial";
};

export const finishRestoreJob = async (db: SessionHubDb, jobId: string, now: Date): Promise<RestoreJobRecord> =>
  db.transaction("rw", db.restoreJobs, async () => {
    const job = await db.restoreJobs.get(jobId);
    if (!job) throw new RestoreJobNotFoundError(`Restore job ${jobId} not found`);
    const finished = { ...job, status: settledStatus(job), updatedAt: now.toISOString() };
    await db.restoreJobs.put(finished);
    return finished;
  });

/**
 * Restores only run inside the background worker, so a job still `running` that was
 * last updated before this worker started was cut off (worker killed, browser closed).
 * Settles each from its recorded outcomes so it can be inspected and retried. Jobs
 * updated after `workerStartedAt` belong to this worker and are left alone.
 */
export const settleInterruptedJobs = (db: SessionHubDb, workerStartedAt: Date, now: Date): Promise<number> =>
  db.transaction("rw", db.restoreJobs, async () => {
    const cutoff = workerStartedAt.toISOString();
    const stale = await db.restoreJobs.filter((job) => job.status === "running" && job.updatedAt < cutoff).toArray();
    const timestamp = now.toISOString();
    await db.restoreJobs.bulkPut(
      stale.map((job) => ({ ...job, status: settledStatus(job), interruptedAt: timestamp, updatedAt: timestamp })),
    );
    return stale.length;
  });

export const RESTORE_JOB_RETENTION = { maxCount: 50, maxAgeDays: 30 } as const;

/** Ids to prune: beyond the newest `maxCount` or older than `maxAgeDays`; the newest job is always kept. */
export const selectJobsToPrune = (
  jobs: readonly { id: string; createdAt: string }[],
  now: Date,
  policy: { maxCount: number; maxAgeDays: number } = RESTORE_JOB_RETENTION,
): string[] => {
  const cutoff = new Date(now.getTime() - policy.maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  return [...jobs]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((job, index) => index > 0 && (index >= policy.maxCount || job.createdAt < cutoff))
    .map((job) => job.id);
};

/** Prunes old jobs using index keys only (job bodies hold whole plans). Never prunes running jobs. */
export const pruneRestoreJobs = (db: SessionHubDb, now: Date, policy = RESTORE_JOB_RETENTION): Promise<number> =>
  db.transaction("rw", db.restoreJobs, async () => {
    const metas: { id: string; createdAt: string }[] = [];
    await db.restoreJobs.orderBy("createdAt").eachKey((createdAt, cursor) => {
      metas.push({ id: String(cursor.primaryKey), createdAt: String(createdAt) });
    });
    const candidates = selectJobsToPrune(metas, now, policy);
    const running = new Set(
      (await db.restoreJobs.bulkGet(candidates)).flatMap((job) => (job?.status === "running" ? [job.id] : [])),
    );
    const prune = candidates.filter((id) => !running.has(id));
    await db.restoreJobs.bulkDelete(prune);
    return prune.length;
  });

/** Most recent restore job for a saved session or recovery checkpoint (the plan's source id). */
export const getLatestRestoreJob = async (db: SessionHubDb, sourceId: string): Promise<RestoreJobRecord | undefined> => {
  const jobs = await db.restoreJobs.where("sessionId").equals(sourceId).toArray();
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
};

/** Worker-start housekeeping. Never throws: housekeeping must not block commands. */
export const runRestoreHousekeeping = async (
  db: SessionHubDb,
  workerStartedAt: Date,
  now: Date,
): Promise<{ settled: number; pruned: number }> => {
  const settled = await settleInterruptedJobs(db, workerStartedAt, now).catch(() => 0);
  const pruned = await pruneRestoreJobs(db, now).catch(() => 0);
  return { settled, pruned };
};
