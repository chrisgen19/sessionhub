import type { RestorePlan } from "@sessionhub/core/restore-plan";
import type { RestoreJobRecord, RestoreTabOutcome, SessionHubDb } from "./db";

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
  };
  await db.restoreJobs.add(job);
  return job;
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

export const finishRestoreJob = async (db: SessionHubDb, jobId: string, now: Date): Promise<RestoreJobRecord> =>
  db.transaction("rw", db.restoreJobs, async () => {
    const job = await db.restoreJobs.get(jobId);
    if (!job) throw new Error(`Restore job ${jobId} not found`);
    const opened = job.outcomes.filter((outcome) => outcome.status === "opened").length;
    const status: RestoreJobRecord["status"] =
      opened === job.plan.tabCount ? "completed" : opened === 0 ? "failed" : "partial";
    const finished = { ...job, status, updatedAt: now.toISOString() };
    await db.restoreJobs.put(finished);
    return finished;
  });
