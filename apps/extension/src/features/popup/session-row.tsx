import type { SavedSession } from "@sessionhub/contracts/session";
import { planRestore, type RestoreDestination } from "@sessionhub/core/restore-plan";
import { summarizeSession } from "@sessionhub/core/session-summary";
import { ChevronRight, Layers, LoaderCircle, Pin } from "lucide-react";
import { useMemo, useState } from "react";
import { buttonClass } from "../../components/modal";
import { SplitButton } from "../../components/split-button";
import type { RestoreJobRecord } from "../../lib/db";
import { formatListDate, plural, sessionSourceLabel } from "../../lib/format";
import { summarizeRestoreJob } from "../../lib/restore-job-repository";
import { SESSION_SYNC_TEXT, type SessionSyncLabel } from "../../lib/sync-status";
import { DESTINATIONS, destinationText } from "../open/open-bar";
import { sendOpen } from "../open/open-command";
import { LARGE_OPEN_THRESHOLD } from "../open/open-panel";

type Phase = { name: "idle" } | { name: "confirm" } | { name: "running" } | { name: "done"; job: RestoreJobRecord } | { name: "error"; message: string };

/** Opening a whole session straight from its row, with the same large-open confirm as the picker. */
const useQuickOpen = (session: SavedSession, destination: RestoreDestination, skipOpen: boolean, lazy: boolean) => {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const plan = useMemo(() => planRestore(session, { layout: destination === "new-windows" ? "original" : "single" }), [session, destination]);
  const start = async () => {
    setPhase({ name: "running" });
    const result = await sendOpen({ session, kind: "session", destination, skipOpen, lazy });
    setPhase(result.ok ? { name: "done", job: result.job } : { name: "error", message: result.message });
  };
  return {
    phase,
    plan,
    open: () => (plan.tabCount > LARGE_OPEN_THRESHOLD ? setPhase({ name: "confirm" }) : void start()),
    confirm: () => void start(),
    reset: () => setPhase({ name: "idle" }),
  };
};

/** One line on what the quick open did; details (failures, retry) live in the manager. */
function DoneLine({ job, onDetails }: { job: RestoreJobRecord; onDetails: () => void }) {
  if (job.plan.tabCount === 0 && (job.plan.alreadyOpen?.length ?? 0) > 0) {
    return <p className="text-fg-muted">Nothing to open: every tab is already open in this window.</p>;
  }
  const { openedCount } = summarizeRestoreJob(job);
  const where = job.target === "this-window" ? "in this window" : `in ${plural(job.plan.windows.length, "new window")}`;
  return (
    <p className={job.status === "completed" ? "text-brand" : "text-danger"}>
      Opened {openedCount} of {plural(job.plan.tabCount, "tab")} {where}.{" "}
      {job.status !== "completed" && (
        <button type="button" className="font-semibold underline" onClick={onDetails}>
          See what didn&apos;t open
        </button>
      )}
    </p>
  );
}

interface SessionRowProps {
  session: SavedSession;
  syncLabel: SessionSyncLabel;
  destination: RestoreDestination;
  onDestination: (destination: RestoreDestination) => void;
  skipOpen: boolean;
  lazy: boolean;
  /** Shows the session's tree in the popup, to choose tabs. */
  onShow: () => void;
  /** Opens the manager on this session. */
  onDetails: () => void;
}

/** A recent session: tap it to choose tabs, or open all of it with the row's Open button. */
export function SessionRow({ session, syncLabel, destination, onDestination, skipOpen, lazy, onShow, onDetails }: SessionRowProps) {
  const quick = useQuickOpen(session, destination, skipOpen, lazy);
  const summary = summarizeSession(session);
  const running = quick.phase.name === "running";
  return (
    <li className="py-1">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onShow} className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1.5 text-left hover:bg-surface-muted">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
            <Layers aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-[13px] font-semibold">
              {session.isPinned && (
                <>
                  <Pin aria-hidden="true" className="size-3 shrink-0 text-brand" />
                  <span className="sr-only">Pinned: </span>
                </>
              )}
              <span className="truncate" title={session.name}>
                {session.name}
              </span>
            </span>
            <span className="block truncate text-[11px] text-fg-muted">
              {formatListDate(session.updatedAt)} · {plural(summary.tabCount, "tab")} · {sessionSourceLabel(session)} · {SESSION_SYNC_TEXT[syncLabel]}
            </span>
          </span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
        </button>
        <SplitButton
          size="sm"
          label={running ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : "Open"}
          labelName={`Open "${session.name}" (${plural(quick.plan.tabCount, "tab")}) ${destinationText(destination, quick.plan.windows.length)}`}
          onClick={quick.open}
          disabled={running || quick.phase.name === "confirm" || quick.plan.tabCount === 0}
          menuDisabled={running}
          options={DESTINATIONS}
          value={destination}
          onSelect={onDestination}
          menuLabel={`Choose where to open "${session.name}"`}
        />
      </div>
      {quick.phase.name !== "idle" && quick.phase.name !== "running" && (
        <div className="pt-1 pb-1.5 pl-12 text-xs">
          {quick.phase.name === "confirm" && (
            <div role="alertdialog" aria-label="Confirm opening" className="flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft px-2.5 py-2">
              <span className="mr-auto font-semibold text-warning">Open {plural(quick.plan.tabCount, "tab")}?</span>
              <button type="button" className={buttonClass.secondary} onClick={quick.reset}>
                Cancel
              </button>
              <button type="button" className={buttonClass.primary} onClick={quick.confirm}>
                Open {plural(quick.plan.tabCount, "tab")}
              </button>
            </div>
          )}
          {quick.phase.name === "done" && <DoneLine job={quick.phase.job} onDetails={onDetails} />}
          {quick.phase.name === "error" && (
            <p role="alert" className="text-danger">
              Restore stopped: {quick.phase.message}{" "}
              <button type="button" className="font-semibold underline" onClick={quick.reset}>
                Dismiss
              </button>
            </p>
          )}
        </div>
      )}
    </li>
  );
}
