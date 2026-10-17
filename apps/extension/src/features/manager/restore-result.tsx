import { useState } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import type { RestoreJobRecord } from "../../lib/db";
import { sendCommand } from "../../lib/message-client";
import { RestoreSummary } from "./restore-summary";

interface RestoreResultProps {
  session: SavedSession;
  job: RestoreJobRecord;
  /** Called with the job returned by a successful retry (live views can ignore it). */
  onJobUpdated?: (job: RestoreJobRecord) => void;
  /** Lets the containing dialog block dismissal while a retry runs. */
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
}

/** Restore summary plus the retry action, shared by the restore dialog and "View summary". */
export function RestoreResult({ session, job, onJobUpdated, onBusyChange, onClose }: RestoreResultProps) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const retry = async () => {
    setRetrying(true);
    setRetryError(null);
    onBusyChange?.(true);
    const response = await sendCommand({ type: "restore.retry", jobId: job.id });
    setRetrying(false);
    onBusyChange?.(false);
    if (response.ok) onJobUpdated?.(response.data.job);
    else setRetryError(response.error.message);
  };

  return (
    <RestoreSummary session={session} job={job} retrying={retrying} retryError={retryError} onRetry={() => void retry()} onClose={onClose} />
  );
}
