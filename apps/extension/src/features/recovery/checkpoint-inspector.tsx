import { ArrowLeft, Download } from "lucide-react";
import { summarizeSession } from "@sessionhub/core/session-summary";
import { buttonClass } from "../../components/modal";
import type { RecoverySnapshotRecord } from "../../lib/db";
import { downloadSessionExport } from "../../lib/export-download";
import { formatFullDate, plural } from "../../lib/format";
import { LastRestore } from "../manager/last-restore";
import { OpenPanel } from "../open/open-panel";

export function CheckpointInspector({ snapshot, onBack }: { snapshot: RecoverySnapshotRecord; onBack: () => void }) {
  const summary = summarizeSession(snapshot.session);

  return (
    <article aria-label="Checkpoint details">
      {/* Same header as a saved session's inspector: title and actions on one row, facts under it. */}
      <header className="space-y-3 border-b border-line px-5 py-5 lg:px-8">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand xl:hidden">
          <ArrowLeft aria-hidden="true" className="size-4" />
          All checkpoints
        </button>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <h2 className="min-w-0 flex-1 basis-[min(100%,20rem)] text-2xl font-bold tracking-tight break-words">{snapshot.session.name}</h2>
          <button type="button" className={buttonClass.secondary} onClick={() => downloadSessionExport(snapshot.session)}>
            <Download aria-hidden="true" className="size-4" />
            Export JSON
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <span className="font-semibold tabular-nums">
            {plural(summary.windowCount, "window")} · {plural(summary.tabCount, "tab")}
          </span>
          <span className="text-fg-muted">
            {snapshot.reason === "manual" ? "Taken manually" : "Saved automatically"} · {formatFullDate(snapshot.capturedAt)} · this browser only
          </span>
        </div>
      </header>
      <div className="space-y-4 px-5 py-5 lg:px-8">
        <LastRestore session={snapshot.session} />
        <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-fg-muted">
          Checkpoints are replaced over time. To keep this one, export it and import the file as a saved session.
        </p>
        <OpenPanel key={snapshot.id} session={snapshot.session} kind="snapshot" />
      </div>
    </article>
  );
}
