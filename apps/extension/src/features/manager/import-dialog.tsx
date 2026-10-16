import { AlertTriangle, FileJson } from "lucide-react";
import { useState } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import type { ImportReport } from "@sessionhub/core/session-import";
import { DialogActions, Modal, buttonClass } from "../../components/modal";
import { formatFullDate, plural, sessionOrigin } from "../../lib/format";
import { sendCommand } from "../../lib/message-client";

export interface ImportPreview {
  fileName: string;
  content: string;
  session: SavedSession;
  report: ImportReport;
}

interface ImportDialogProps {
  preview: ImportPreview | null;
  error: { fileName: string; message: string } | null;
  onClose: () => void;
  onImported: (sessionId: string) => void;
}

function PreviewBody({ preview }: { preview: ImportPreview }) {
  const { session, report } = preview;
  const notRestorable = Object.values(report.notRestorable).reduce((sum, count) => sum + count, 0);
  return (
    <>
      <div className="rounded-lg border border-line px-3 py-2.5">
        <p className="text-[13px] font-semibold break-words">{session.name}</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          {sessionOrigin(session)} · exported {formatFullDate(report.exportedAt)}
        </p>
        <p className="mt-1 text-xs font-semibold tabular-nums">
          {plural(report.windowCount, "window")} · {plural(report.tabCount, "tab")}
        </p>
      </div>
      <p className="mt-3 rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand">
        It will be added as a new session. Your existing sessions and open tabs aren't changed, and nothing opens until you
        choose Restore.
      </p>
      {notRestorable > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          <AlertTriangle aria-hidden="true" className="mt-px size-4 shrink-0" />
          <span>
            {plural(notRestorable, "tab")} can't be reopened and will be kept for reference only.
            {report.reclassifiedCount > 0 &&
              ` ${plural(report.reclassifiedCount, "tab")} in this file claimed a different status and ${report.reclassifiedCount === 1 ? "was" : "were"} re-checked.`}
          </span>
        </p>
      )}
    </>
  );
}

/** Preview-then-confirm import. The worker re-parses the raw file on confirm. */
export function ImportDialog({ preview, error, onClose, onImported }: ImportDialogProps) {
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    const response = await sendCommand({ type: "session.import", content: preview.content });
    setBusy(false);
    if (response.ok) onImported(response.data.sessionId);
    else setImportError(response.error.message);
  };

  const fileName = preview?.fileName ?? error?.fileName ?? "";
  return (
    <Modal title={preview ? "Import session" : "Can't import this file"} onClose={onClose} dismissible={!busy}>
      <p className="mb-3 flex items-center gap-1.5 truncate text-xs text-fg-muted" title={fileName}>
        <FileJson aria-hidden="true" className="size-4 shrink-0" />
        {fileName}
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {error.message}
        </p>
      )}
      {preview && <PreviewBody preview={preview} />}
      {importError && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          Not imported: {importError}
        </p>
      )}
      <DialogActions>
        <button type="button" className={buttonClass.secondary} onClick={onClose} disabled={busy}>
          {preview ? "Cancel" : "Close"}
        </button>
        {preview && (
          <button type="button" className={buttonClass.primary} onClick={() => void confirm()} disabled={busy}>
            Import session
          </button>
        )}
      </DialogActions>
    </Modal>
  );
}
