import { useState } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { summarizeSession } from "@sessionhub/core/session-summary";
import { DialogActions, Modal, buttonClass } from "../../components/modal";
import { plural } from "../../lib/format";
import { sendCommand } from "../../lib/message-client";

interface DeleteDialogProps {
  session: SavedSession;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteDialog({ session, onClose, onDeleted }: DeleteDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { tabCount } = summarizeSession(session);

  const confirm = async () => {
    setBusy(true);
    const response = await sendCommand({ type: "session.delete", sessionId: session.id });
    setBusy(false);
    if (response.ok) onDeleted();
    else setError(response.error.message);
  };

  return (
    <Modal title={`Delete "${session.name}"?`} onClose={onClose} dismissible={!busy}>
      <p className="text-[13px] text-fg-muted">
        This removes the saved session and its {plural(tabCount, "tab")} from this browser. Tabs you have open right now are not
        affected. This can't be undone, so export it first if you might need it.
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          Not deleted: {error}
        </p>
      )}
      <DialogActions>
        {/* Cancel comes first in tab order and receives initial focus from the dialog. */}
        <button type="button" autoFocus className={buttonClass.secondary} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={buttonClass.danger} onClick={() => void confirm()} disabled={busy}>
          Delete session
        </button>
      </DialogActions>
    </Modal>
  );
}
