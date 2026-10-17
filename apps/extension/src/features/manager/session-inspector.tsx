import { AlertTriangle, ArrowLeft, Download, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { summarizeSession } from "@sessionhub/core/session-summary";
import { SessionSyncBadge } from "../../components/sync-status-chip";
import { buttonClass } from "../../components/modal";
import { downloadSessionExport } from "../../lib/export-download";
import { formatFullDate, plural, sessionOrigin } from "../../lib/format";
import type { SessionSyncLabel } from "../../lib/sync-status";
import { useReviewItems } from "../../hooks/use-review";
import { ReviewDialog } from "../review/review-dialog";
import { WorkspacePicker } from "../workspaces/workspace-picker";
import { DeleteDialog } from "./delete-dialog";
import { LastRestore } from "./last-restore";
import { RenameTitle } from "./rename-title";
import { RestoreDialog } from "./restore-dialog";
import { WindowTree } from "./window-tree";

interface SessionInspectorProps {
  session: SavedSession;
  syncLabel: SessionSyncLabel;
  /** Its account workspace (null: none). */
  workspaceId: string | null;
  onBack: () => void;
  onDeleted: () => void;
  /** Opens another session (after a review that kept this browser's version as a new one). */
  onOpen: (id: string) => void;
}

export function SessionInspector({ session, syncLabel, workspaceId, onBack, onDeleted, onOpen }: SessionInspectorProps) {
  const [dialog, setDialog] = useState<"restore" | "delete" | "review" | null>(null);
  const review = useReviewItems()?.find((item) => item.sessionId === session.id);
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
          {sessionOrigin(session)} · saved {formatFullDate(session.updatedAt)} · version {session.version}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold tabular-nums">
            {plural(summary.windowCount, "window")} · {plural(summary.tabCount, "tab")}
          </span>
          <SessionSyncBadge label={syncLabel} />
        </div>
        <WorkspacePicker sessionId={session.id} inAccount={syncLabel !== "local"} workspaceId={workspaceId} />
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

      {review && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg bg-warning-soft px-3 py-2.5 text-xs text-fg">
          <span className="min-w-0 flex-1">
            <span className="font-semibold">Needs review.</span> Your account didn&apos;t accept the last change. Both versions are kept until you choose.
          </span>
          <button type="button" className={buttonClass.secondary} onClick={() => setDialog("review")}>
            Review…
          </button>
        </div>
      )}

      <LastRestore session={session} />

      {notRestorable > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          <AlertTriangle aria-hidden="true" className="mt-px size-4 shrink-0" />
          {plural(notRestorable, "tab")} can't be reopened (browser pages, local files or unsupported links). They're kept here
          for reference.
        </p>
      )}

      <WindowTree session={session} />

      {dialog === "restore" && <RestoreDialog session={session} onClose={() => setDialog(null)} />}
      {dialog === "review" && review && (
        <ReviewDialog
          item={review}
          onClose={() => setDialog(null)}
          onResolved={(id) => {
            setDialog(null);
            if (id !== session.id) onOpen(id);
          }}
        />
      )}
      {dialog === "delete" && (
        <DeleteDialog
          session={session}
          inAccount={syncLabel !== "local"}
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
