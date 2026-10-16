import { History } from "lucide-react";
import { useState } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { Modal } from "../../components/modal";
import { useLatestRestoreJob } from "../../hooks/use-latest-restore-job";
import { formatListDate } from "../../lib/format";
import { summarizeRestoreJob } from "../../lib/restore-job-repository";
import { RestoreResult } from "./restore-result";

/** "Last restore" line for an inspector, reopening that job's summary (and retry) on demand. */
export function LastRestore({ session }: { session: SavedSession }) {
  const job = useLatestRestoreJob(session.id);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!job) return null;

  const { openedCount } = summarizeRestoreJob(job);
  const status =
    job.status === "running"
      ? "in progress"
      : job.status === "completed"
        ? `opened all ${job.plan.tabCount}`
        : `opened ${openedCount} of ${job.plan.tabCount}${job.interruptedAt ? ", interrupted" : ""}`;
  const needsAttention = job.status === "partial" || job.status === "failed";

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ${
        needsAttention ? "bg-danger-soft text-danger" : "bg-surface-muted text-fg-muted"
      }`}
    >
      <span className="flex items-center gap-1.5">
        <History aria-hidden="true" className="size-3.5 shrink-0" />
        Last restore {formatListDate(job.createdAt)}: {status}
      </span>
      <button type="button" className="font-semibold underline" onClick={() => setOpen(true)}>
        View summary
      </button>
      {open && (
        <Modal title={`Last restore of "${session.name}"`} onClose={() => setOpen(false)} dismissible={!busy}>
          <RestoreResult session={session} job={job} onBusyChange={setBusy} onClose={() => setOpen(false)} />
        </Modal>
      )}
    </div>
  );
}
