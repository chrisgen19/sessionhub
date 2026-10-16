import { ArrowLeft, Download, RotateCcw } from "lucide-react";
import { useState } from "react";
import { summarizeSession } from "@sessionhub/core/session-summary";
import { buttonClass } from "../../components/modal";
import type { RecoverySnapshotRecord } from "../../lib/db";
import { downloadSessionExport } from "../../lib/export-download";
import { formatFullDate, plural } from "../../lib/format";
import { LastRestore } from "../manager/last-restore";
import { RestoreDialog } from "../manager/restore-dialog";
import { WindowTree } from "../manager/window-tree";

export function CheckpointInspector({ snapshot, onBack }: { snapshot: RecoverySnapshotRecord; onBack: () => void }) {
  const [restoring, setRestoring] = useState(false);
  const summary = summarizeSession(snapshot.session);

  return (
    <article aria-label="Checkpoint details" className="space-y-5 p-5 lg:p-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand xl:hidden">
        <ArrowLeft aria-hidden="true" className="size-4" />
        All checkpoints
      </button>
      <div className="space-y-2">
        <h2 className="text-xl font-bold tracking-tight">{snapshot.session.name}</h2>
        <p className="text-xs text-fg-muted">
          {snapshot.reason === "manual" ? "Taken manually" : "Saved automatically"} · {formatFullDate(snapshot.capturedAt)} · this
          browser only
        </p>
        <p className="text-xs font-semibold tabular-nums">
          {plural(summary.windowCount, "window")} · {plural(summary.tabCount, "tab")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass.primary} disabled={summary.restorableTabCount === 0} onClick={() => setRestoring(true)}>
          <RotateCcw aria-hidden="true" className="size-4" />
          Restore…
        </button>
        <button type="button" className={buttonClass.secondary} onClick={() => downloadSessionExport(snapshot.session)}>
          <Download aria-hidden="true" className="size-4" />
          Export JSON
        </button>
      </div>
      <LastRestore session={snapshot.session} />
      <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-fg-muted">
        Checkpoints are replaced over time. To keep this one, export it and import the file as a saved session.
      </p>
      <WindowTree session={snapshot.session} />
      {restoring && <RestoreDialog session={snapshot.session} kind="snapshot" onClose={() => setRestoring(false)} />}
    </article>
  );
}
