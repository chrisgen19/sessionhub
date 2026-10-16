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

/** Appends outcomes as the restore progresses (one write per window). */
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

export const finishRestoreJob = async (db: SessionHubDb, jobId: string, now: Date): Promise<RestoreJobRecord> =>
  db.transaction("rw", db.restoreJobs, async () => {
    const job = await db.restoreJobs.get(jobId);
    if (!job) throw new RestoreJobNotFoundError(`Restore job ${jobId} not found`);
    const { openedCount } = summarizeRestoreJob(job);
    const status: RestoreJobRecord["status"] =
      openedCount === job.plan.tabCount ? "completed" : openedCount === 0 ? "failed" : "partial";
    const finished = { ...job, status, updatedAt: now.toISOString() };
    await db.restoreJobs.put(finished);
    return finished;
  });
