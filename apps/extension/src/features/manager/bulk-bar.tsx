import { Archive, ArchiveRestore, FolderInput, Tag, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { buttonClass } from "../../components/modal";
import { bulkResultText } from "../../lib/bulk-text";
import { plural } from "../../lib/format";
import { sendCommand } from "../../lib/message-client";
import type { BulkAction } from "../../lib/session-organize";
import { BulkDeleteDialog, BulkMoveDialog, BulkTagDialog } from "./bulk-dialogs";

const smallButton = `${buttonClass.secondary} h-8 px-2.5 text-xs`;

interface BulkBarProps {
  /** The ticked sessions the list shows (ticks hidden by a search or filter don't count). */
  selected: SavedSession[];
  visibleCount: number;
  archivedView: boolean;
  /** Workspaces to move into; null when moving isn't offered (not connected, or none to choose). */
  workspaces: { id: string; name: string }[] | null;
  tags: string[];
  inAccount: (id: string) => boolean;
  onSelectAll: () => void;
  onClear: () => void;
}

/**
 * The sticky bulk-action bar (docs/UI_UX_DESIGN.md 18p): count, select all or none, then Archive,
 * Tag, Move and Delete for the ticked sessions. Says what happened once it's done.
 */
export function BulkBar({ selected, visibleCount, archivedView, workspaces, tags, inAccount, onSelectAll, onClear }: BulkBarProps) {
  const [dialog, setDialog] = useState<"delete" | "tag" | "move" | null>(null);
  const [status, setStatus] = useState<{ text: string; failed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const accountCount = selected.filter((session) => inAccount(session.id)).length;

  /** Resolves to an error message for a dialog, or null once done. */
  const run = async (action: BulkAction): Promise<string | null> => {
    setBusy(true);
    const response = await sendCommand({ type: "session.bulk", sessionIds: selected.map((session) => session.id), action });
    setBusy(false);
    if (!response.ok) return response.error.message;
    const workspace = action.kind === "assign" ? (workspaces?.find((space) => space.id === action.workspaceId)?.name ?? null) : null;
    setStatus({ text: bulkResultText(action, response.data, workspace), failed: false });
    setDialog(null);
    onClear();
    return null;
  };

  if (selected.length === 0) {
    if (!status) return null;
    return (
      <p role={status.failed ? "alert" : "status"} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${status.failed ? "bg-danger-soft text-danger" : "bg-surface-muted"}`}>
        <span className="min-w-0 flex-1">{status.text}</span>
        <button type="button" aria-label="Dismiss" onClick={() => setStatus(null)} className="shrink-0 text-fg-muted hover:text-fg">
          <X aria-hidden="true" className="size-4" />
        </button>
      </p>
    );
  }

  const archive = async () => {
    const failure = await run({ kind: "archive", archived: !archivedView });
    if (failure) setStatus({ text: `Nothing changed: ${failure}`, failed: true });
  };

  return (
    <div role="region" aria-label="Bulk actions" className="space-y-2 rounded-lg border border-line bg-canvas p-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <p aria-live="polite" className="text-xs font-semibold tabular-nums">
          {plural(selected.length, "session")} selected
        </p>
        {selected.length < visibleCount && (
          <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={onSelectAll}>
            Select all {visibleCount}
          </button>
        )}
        <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={onClear}>
          Clear
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={smallButton} disabled={busy} onClick={() => void archive()}>
          {archivedView ? <ArchiveRestore aria-hidden="true" className="size-3.5" /> : <Archive aria-hidden="true" className="size-3.5" />}
          {archivedView ? "Unarchive" : "Archive"}
        </button>
        <button type="button" className={smallButton} disabled={busy} onClick={() => setDialog("tag")}>
          <Tag aria-hidden="true" className="size-3.5" />
          Tag…
        </button>
        {workspaces && (
          <button type="button" className={smallButton} disabled={busy} onClick={() => setDialog("move")}>
            <FolderInput aria-hidden="true" className="size-3.5" />
            Move…
          </button>
        )}
        <button type="button" className={`${buttonClass.ghostDanger} h-8 px-2.5 text-xs`} disabled={busy} onClick={() => setDialog("delete")}>
          <Trash2 aria-hidden="true" className="size-3.5" />
          Delete…
        </button>
      </div>
      {status?.failed && (
        <p role="alert" className="px-1 text-xs text-danger">
          {status.text}
        </p>
      )}
      {dialog === "delete" && <BulkDeleteDialog sessions={selected} inAccount={accountCount} onClose={() => setDialog(null)} onConfirm={() => run({ kind: "delete" })} />}
      {dialog === "tag" && <BulkTagDialog count={selected.length} suggestions={tags} onClose={() => setDialog(null)} onConfirm={(tag, add) => run({ kind: "tag", tag, add })} />}
      {dialog === "move" && workspaces && (
        <BulkMoveDialog
          count={selected.length}
          notInAccount={selected.length - accountCount}
          workspaces={workspaces}
          onClose={() => setDialog(null)}
          onConfirm={(workspaceId) => run({ kind: "assign", workspaceId })}
        />
      )}
    </div>
  );
}
