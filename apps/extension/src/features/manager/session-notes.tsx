import { useId, useState, type FormEvent } from "react";
import { SESSION_LIMITS, type SavedSession } from "@sessionhub/contracts/session";
import { buttonClass } from "../../components/modal";
import { useSessionEdit } from "../../hooks/use-session-edit";

const linkClass = "text-xs font-semibold text-brand hover:underline";

/**
 * A session's notes: shown as written, edited in place (saved with the session, synced with it). The
 * session updates live while the editor is open, so saving first checks the notes are still the ones
 * editing started from: notes changed elsewhere are shown, never overwritten without a second Save.
 * Other changes meanwhile (pin, archive, tags) don't block it.
 */
export function SessionNotes({ session }: { session: SavedSession }) {
  const { busy, error, edit } = useSessionEdit(session);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [base, setBase] = useState<string | null>(null);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const id = useId();
  const notes = session.description ?? null;

  const start = () => {
    setDraft(notes ?? "");
    setBase(notes);
    setChangedElsewhere(false);
    setEditing(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (notes !== base) {
      // Show what's there now; saving again replaces it with the draft.
      setBase(notes);
      setChangedElsewhere(true);
      return;
    }
    if (await edit({ description: draft })) setEditing(false);
  };

  if (!editing) {
    return notes ? (
      <div className="space-y-1">
        <p className="text-[13px] break-words whitespace-pre-wrap">{notes}</p>
        <button type="button" className={linkClass} onClick={start}>
          Edit notes
        </button>
      </div>
    ) : (
      <button type="button" className={linkClass} onClick={start}>
        Add notes
      </button>
    );
  }

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-2">
      <label htmlFor={id} className="text-xs font-semibold text-fg-muted">
        Notes
      </label>
      <textarea
        id={id}
        autoFocus
        rows={4}
        value={draft}
        maxLength={SESSION_LIMITS.descriptionMax}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setEditing(false);
        }}
        className="block w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13px]"
      />
      {changedElsewhere && (
        <div role="alert" className="space-y-1 rounded-lg bg-warning-soft px-3 py-2 text-xs">
          <p className="font-semibold">These notes changed in another window while you were editing. Your text is kept above; Save notes again to replace them.</p>
          <p className="break-words whitespace-pre-wrap text-fg-muted">{notes ?? "(The notes were removed.)"}</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          Notes not saved: {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={buttonClass.primary}>
          Save notes
        </button>
        <button type="button" onClick={() => setEditing(false)} className={buttonClass.secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}
