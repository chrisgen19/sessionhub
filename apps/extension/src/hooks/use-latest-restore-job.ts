import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { getDb, type RestoreJobRecord } from "../lib/db";
import { getLatestRestoreJob } from "../lib/restore-job-repository";

/** Live latest restore job for a session or checkpoint id; undefined when there is none (or on error). */
export function useLatestRestoreJob(sourceId: string): RestoreJobRecord | undefined {
  const [job, setJob] = useState<RestoreJobRecord | undefined>(undefined);

  useEffect(() => {
    const subscription = liveQuery(() => getLatestRestoreJob(getDb(), sourceId)).subscribe({
      next: setJob,
      // The summary is a convenience; a read failure just hides it.
      error: () => setJob(undefined),
    });
    return () => subscription.unsubscribe();
  }, [sourceId]);

  return job;
}
