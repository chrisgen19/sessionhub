import { CheckCircle2, XCircle } from "lucide-react";
import type { SavedSession } from "@sessionhub/contracts/session";
import type { SkippedTab } from "@sessionhub/core/restore-plan";
import { displayUrl } from "@sessionhub/core/url-classification";
import { DialogActions, buttonClass } from "../../components/modal";
import type { RestoreJobRecord } from "../../lib/db";
import { plural } from "../../lib/format";

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

/** Honest completion summary: what opened, what failed and why. */
export function RestoreSummary({ session, job, onClose }: { session: SavedSession; job: RestoreJobRecord; onClose: () => void }) {
  const tabsById = new Map(session.windows.flatMap((window) => window.tabs.map((tab) => [tab.id, tab] as const)));
  const opened = job.outcomes.filter((outcome) => outcome.status === "opened").length;
  const failed = job.outcomes.flatMap((outcome) => (outcome.status === "failed" ? [outcome] : []));
  const ok = job.status === "completed";

  return (
    <>
      <p role="status" className={`mt-5 flex items-center gap-2 text-[13px] font-semibold ${ok ? "text-brand" : "text-danger"}`}>
        {ok ? <CheckCircle2 aria-hidden="true" className="size-4" /> : <XCircle aria-hidden="true" className="size-4" />}
        Opened {opened} of {plural(job.plan.tabCount, "tab")} in {plural(job.plan.windows.length, "new window")}.
      </p>
      {failed.length > 0 && (
        <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          <p className="font-semibold">{plural(failed.length, "tab")} couldn't be opened</p>
          <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto">
            {failed.map((outcome) => {
              const tab = tabsById.get(outcome.sourceTabId);
              return (
                <li key={outcome.sourceTabId} className="truncate" title={tab?.url}>
                  {tab ? tab.title || displayUrl(tab.url) : "Unknown tab"}: {outcome.error}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {job.plan.skipped.length > 0 && (
        <div className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          <p className="font-semibold">{plural(job.plan.skipped.length, "tab")} skipped</p>
          <SkippedList skipped={job.plan.skipped} />
        </div>
      )}
      <DialogActions>
        <button type="button" className={buttonClass.primary} onClick={onClose}>
          Done
        </button>
      </DialogActions>
    </>
  );
}
