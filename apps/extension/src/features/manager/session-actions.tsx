import { Archive, ArchiveRestore, Copy, Download, Pin, PinOff, Trash2 } from "lucide-react";
import { useState } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { buttonClass } from "../../components/modal";
import { useSessionEdit } from "../../hooks/use-session-edit";
import { downloadSessionExport } from "../../lib/export-download";
import { sendCommand } from "../../lib/message-client";

interface SessionActionsProps {
  session: SavedSession;
  /** Shows the copy once it's saved. */
  onDuplicated: (id: string) => void;
  onDelete: () => void;
}

/** The inspector's own actions: Pin, Archive, Duplicate, Export JSON and Delete. */
export function SessionActions({ session, onDuplicated, onDelete }: SessionActionsProps) {
  const { busy, error, edit } = useSessionEdit(session);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const pinned = session.isPinned === true;
  const archived = session.isArchived === true;

  const duplicate = async () => {
    setCopying(true);
    setCopyError(null);
    const response = await sendCommand({ type: "session.duplicate", sessionId: session.id });
    setCopying(false);
    if (response.ok) onDuplicated(response.data.sessionId);
    else setCopyError(response.error.message);
  };

  const failure = error ? `Not changed: ${error}` : copyError ? `No copy made: ${copyError}` : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={pinned} className={buttonClass.secondary} disabled={busy} onClick={() => void edit({ isPinned: !pinned })}>
          {pinned ? <PinOff aria-hidden="true" className="size-4" /> : <Pin aria-hidden="true" className="size-4" />}
          {pinned ? "Unpin" : "Pin"}
        </button>
        <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => void edit({ isArchived: !archived })}>
          {archived ? <ArchiveRestore aria-hidden="true" className="size-4" /> : <Archive aria-hidden="true" className="size-4" />}
          {archived ? "Unarchive" : "Archive"}
        </button>
        <button type="button" className={buttonClass.secondary} disabled={copying} onClick={() => void duplicate()}>
          <Copy aria-hidden="true" className="size-4" />
          Duplicate
        </button>
        <button type="button" className={buttonClass.secondary} onClick={() => downloadSessionExport(session)}>
          <Download aria-hidden="true" className="size-4" />
          Export JSON
        </button>
        <button type="button" className={buttonClass.ghostDanger} onClick={onDelete}>
          <Trash2 aria-hidden="true" className="size-4" />
          Delete
        </button>
      </div>
      {failure && (
        <p role="alert" className="text-xs text-danger">
          {failure}
        </p>
      )}
    </div>
  );
}
