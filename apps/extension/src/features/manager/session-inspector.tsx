import { AlertTriangle, ArrowLeft, Download, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { summarizeSession } from "@sessionhub/core/session-summary";
import { SyncStatusChip } from "../../components/brand";
import { buttonClass } from "../../components/modal";
import { downloadSessionExport } from "../../lib/export-download";
import { formatFullDate, plural } from "../../lib/format";
import { DeleteDialog } from "./delete-dialog";
import { RenameTitle } from "./rename-title";
import { RestoreDialog } from "./restore-dialog";
import { WindowTree } from "./window-tree";

interface SessionInspectorProps {
  session: SavedSession;
  onBack: () => void;
  onDeleted: () => void;
}

export function SessionInspector({ session, onBack, onDeleted }: SessionInspectorProps) {
  const [dialog, setDialog] = useState<"restore" | "delete" | null>(null);
  const summary = summarizeSession(session);
  const notRestorable = summary.tabCount - summary.restorableTabCount;

  return (
    <article aria-label="Session details" className="space-y-5 p-5 lg:p-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand xl:hidden">
        <ArrowLeft aria-hidden="true" className="size-4" />
        All sessions
      </button>

      <div className="space-y-2">
        <RenameTitle key={`${session.id}:${session.version}`} session={session} />
        <p className="text-xs text-fg-muted">
          From {session.sourceDeviceName} · saved {formatFullDate(session.updatedAt)} · version {session.version}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold tabular-nums">
            {plural(summary.windowCount, "window")} · {plural(summary.tabCount, "tab")}
          </span>
          <SyncStatusChip />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass.primary}
          disabled={summary.restorableTabCount === 0}
          onClick={() => setDialog("restore")}
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          Restore…
        </button>
        <button type="button" className={buttonClass.secondary} onClick={() => downloadSessionExport(session)}>
          <Download aria-hidden="true" className="size-4" />
          Export JSON
        </button>
        <button type="button" className={buttonClass.ghostDanger} onClick={() => setDialog("delete")}>
          <Trash2 aria-hidden="true" className="size-4" />
          Delete
        </button>
      </div>

      {notRestorable > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          <AlertTriangle aria-hidden="true" className="mt-px size-4 shrink-0" />
          {plural(notRestorable, "tab")} can't be reopened (browser pages, local files or unsupported links). They're kept here
          for reference.
        </p>
      )}

      <WindowTree session={session} />

      {dialog === "restore" && <RestoreDialog session={session} onClose={() => setDialog(null)} />}
      {dialog === "delete" && (
        <DeleteDialog
          session={session}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            onDeleted();
          }}
        />
      )}
    </article>
  );
}
