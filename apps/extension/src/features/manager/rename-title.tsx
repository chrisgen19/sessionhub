import { Pencil } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { SESSION_LIMITS } from "@sessionhub/contracts/session";
import { buttonClass } from "../../components/modal";
import { sendCommand } from "../../lib/message-client";

/** Session title with inline rename guarded by the session's current version. */
export function RenameTitle({ session }: { session: SavedSession }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startEditing = () => {
    setDraft(session.name);
    setError(null);
    setEditing(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const response = await sendCommand({
      type: "session.rename",
      sessionId: session.id,
      expectedVersion: session.version,
      name: draft,
    });
    setBusy(false);
    if (response.ok) setEditing(false);
    else setError(response.error.message);
  };

  if (!editing) {
    return (
      <div className="flex items-start gap-1.5">
        {/* The pencil follows the name rather than the far edge, so it reads as part of the title. */}
        <h2 className="min-w-0 text-2xl font-bold tracking-tight break-words">{session.name}</h2>
        <button
          type="button"
          onClick={startEditing}
          aria-label="Rename session"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-surface-muted"
        >
          <Pencil aria-hidden="true" className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-2">
      <label className="block">
        <span className="sr-only">Session name</span>
        <input
          autoFocus
          value={draft}
          maxLength={SESSION_LIMITS.nameMax}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
          }}
          className="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-[15px] font-semibold"
        />
      </label>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={buttonClass.primary}>
          Save name
        </button>
        <button type="button" onClick={() => setEditing(false)} className={buttonClass.secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}
