import { useId, useState, type FormEvent } from "react";
import { SESSION_LIMITS, type SavedSession } from "@sessionhub/contracts/session";
import { buttonClass } from "../../components/modal";
import { useSessionEdit } from "../../hooks/use-session-edit";

const linkClass = "text-xs font-semibold text-brand hover:underline";

/** A session's notes: shown as written, edited in place (saved with the session, synced with it). */
export function SessionNotes({ session }: { session: SavedSession }) {
  const { busy, error, edit } = useSessionEdit(session);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const id = useId();
  const notes = session.description ?? null;

  const start = () => {
    setDraft(notes ?? "");
    setEditing(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
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
