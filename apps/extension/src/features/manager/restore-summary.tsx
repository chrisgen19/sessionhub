import { CheckCircle2, LoaderCircle, RotateCcw, XCircle } from "lucide-react";
import type { SavedSession } from "@sessionhub/contracts/session";
import type { SkippedTab } from "@sessionhub/core/restore-plan";
import { displayUrl } from "@sessionhub/core/url-classification";
import { DialogActions, buttonClass } from "../../components/modal";
import type { RestoreJobRecord } from "../../lib/db";
import { plural } from "../../lib/format";
import { summarizeRestoreJob } from "../../lib/restore-job-repository";

export function SkippedList({ skipped }: { skipped: SkippedTab[] }) {
  return (
    <ul className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto">
      {skipped.map((tab) => (
        <li key={tab.sourceTabId} className="truncate" title={tab.url}>
          {tab.title || displayUrl(tab.url)}: {tab.reason}
        </li>
      ))}
    </ul>
  );
}

interface RestoreSummaryProps {
  session: SavedSession;
  job: RestoreJobRecord;
  retrying: boolean;
  retryError: string | null;
  onRetry: () => void;
  onClose: () => void;
}

/** Honest completion summary: what opened, what failed and why, with retry for the rest. */
export function RestoreSummary({ session, job, retrying, retryError, onRetry, onClose }: RestoreSummaryProps) {
  const tabsById = new Map(session.windows.flatMap((window) => window.tabs.map((tab) => [tab.id, tab] as const)));
  const plannedById = new Map(job.plan.windows.flatMap((window) => window.tabs.map((tab) => [tab.sourceTabId, tab] as const)));
  const { openedCount, failed, notAttemptedCount } = summarizeRestoreJob(job);
  const remaining = failed.length + notAttemptedCount;
  const ok = job.status === "completed";
  const running = job.status === "running";
  const attempts = job.attempts ?? 1;

  return (
    <>
      <p role="status" className={`mt-5 flex items-center gap-2 text-[13px] font-semibold ${ok ? "text-brand" : running ? "" : "text-danger"}`}>
        {running ? (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        ) : ok ? (
          <CheckCircle2 aria-hidden="true" className="size-4" />
        ) : (
          <XCircle aria-hidden="true" className="size-4" />
        )}
        {running ? "Still restoring: opened " : "Opened "}
        {openedCount} of {plural(job.plan.tabCount, "tab")}
        {attempts > 1 ? ` after ${plural(attempts, "attempt")}` : ` in ${plural(job.plan.windows.length, "new window")}`}.
      </p>
      {job.interruptedAt && (
        <p className="mt-2 text-xs text-fg-muted">
          This restore was cut off (the browser or SessionHub stopped) and was finished up afterwards. Tabs it didn't reach
          can be retried.
        </p>
      )}
      {remaining > 0 && !running && (
        <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          <p className="font-semibold">{plural(remaining, "tab")} didn't open</p>
          <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto">
            {failed.map((outcome) => {
              const tab = tabsById.get(outcome.sourceTabId);
              const url = tab?.url ?? plannedById.get(outcome.sourceTabId)?.url ?? "";
              return (
                <li key={outcome.sourceTabId} className="truncate" title={url}>
                  {tab?.title || displayUrl(url) || "Unknown tab"}: {outcome.error}
                </li>
              );
            })}
            {notAttemptedCount > 0 && <li>{plural(notAttemptedCount, "tab")} weren't reached before the restore stopped</li>}
          </ul>
          <p className="mt-1.5 text-fg-muted">Retry opens only these tabs, in a new window. Tabs that already opened aren't opened again.</p>
        </div>
      )}
      {job.plan.skipped.length > 0 && (
        <div className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          <p className="font-semibold">{plural(job.plan.skipped.length, "tab")} skipped</p>
          <SkippedList skipped={job.plan.skipped} />
        </div>
      )}
      {retryError && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          Retry didn't start: {retryError}
        </p>
      )}
      <DialogActions>
        {remaining > 0 && job.status !== "running" && (
          <button type="button" className={buttonClass.secondary} disabled={retrying} onClick={onRetry}>
            {retrying ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <RotateCcw aria-hidden="true" className="size-4" />}
            {retrying ? "Retrying…" : `Retry ${plural(remaining, "tab")}`}
          </button>
        )}
        <button type="button" className={buttonClass.primary} disabled={retrying} onClick={onClose}>
          Done
        </button>
      </DialogActions>
    </>
  );
}
