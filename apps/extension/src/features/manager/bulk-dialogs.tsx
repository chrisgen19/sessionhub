import { useId, useState } from "react";
import { SESSION_LIMITS, type SavedSession } from "@sessionhub/contracts/session";
import { DialogActions, Modal, buttonClass } from "../../components/modal";
import { plural } from "../../lib/format";
import { inputClass, selectClass } from "../workspaces/workspace-fields";

/** Runs the confirmed action; resolves to an error message, or null once it's done (the caller closes). */
type Confirm<T extends unknown[]> = (...args: T) => Promise<string | null>;

function useRun<T extends unknown[]>(confirm: Confirm<T>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (...args: T) => {
    setBusy(true);
    setError(null);
    const failure = await confirm(...args);
    setBusy(false);
    setError(failure);
  };
  return { busy, error, run };
}

function Failure({ error, what }: { error: string | null; what: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
      {what}: {error}
    </p>
  );
}

const NAMES_SHOWN = 5;

interface BulkDeleteDialogProps {
  sessions: SavedSession[];
  /** How many are in the account (deleted from the other connected browsers too). */
  inAccount: number;
  onClose: () => void;
  onConfirm: Confirm<[]>;
}

/** Names what will be deleted before anything is (docs/UI_UX_DESIGN.md, Bulk selection and actions). */
export function BulkDeleteDialog({ sessions, inAccount, onClose, onConfirm }: BulkDeleteDialogProps) {
  const { busy, error, run } = useRun(onConfirm);
  const tabs = sessions.reduce((sum, session) => sum + session.windows.reduce((count, window) => count + window.tabs.length, 0), 0);
  return (
    <Modal title={`Delete ${plural(sessions.length, "session")}?`} onClose={onClose} dismissible={!busy}>
      <ul className="space-y-0.5 text-[13px] font-semibold">
        {sessions.slice(0, NAMES_SHOWN).map((session) => (
          <li key={session.id} className="truncate">
            {session.name}
          </li>
        ))}
        {sessions.length > NAMES_SHOWN && <li className="font-normal text-fg-muted">and {plural(sessions.length - NAMES_SHOWN, "more session")}</li>}
      </ul>
      <p className="mt-3 text-[13px] text-fg-muted">
        This removes them and their {plural(tabs, "tab")}
        {inAccount > 0 ? `. ${plural(inAccount, "session")} in your account ${inAccount === 1 ? "is" : "are"} removed from your other connected browsers at their next sync too.` : " from this browser."}{" "}
        Tabs you have open right now are not affected. This can&apos;t be undone.
      </p>
      <Failure error={error} what="Not deleted" />
      <DialogActions>
        <button type="button" autoFocus className={buttonClass.secondary} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={buttonClass.danger} onClick={() => void run()} disabled={busy}>
          Delete {plural(sessions.length, "session")}
        </button>
      </DialogActions>
    </Modal>
  );
}

interface BulkTagDialogProps {
  count: number;
  /** Tags already in use, offered as the user types. */
  suggestions: string[];
  onClose: () => void;
  onConfirm: Confirm<[tag: string, add: boolean]>;
}

/** Adds a tag to the selected sessions, or removes it from them. */
export function BulkTagDialog({ count, suggestions, onClose, onConfirm }: BulkTagDialogProps) {
  const { busy, error, run } = useRun(onConfirm);
  const [tag, setTag] = useState("");
  const inputId = useId();
  const listId = useId();
  const blank = tag.trim().length === 0;
  return (
    <Modal title={`Tag ${plural(count, "session")}`} onClose={onClose} dismissible={!busy}>
      <label htmlFor={inputId} className="text-xs font-semibold text-fg-muted">
        Tag
      </label>
      <input id={inputId} list={listId} autoFocus value={tag} maxLength={SESSION_LIMITS.tagMax} onChange={(event) => setTag(event.target.value)} className={`${inputClass} mt-1`} />
      <datalist id={listId}>
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
      <Failure error={error} what="Not changed" />
      <DialogActions>
        <button type="button" className={buttonClass.secondary} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={buttonClass.secondary} onClick={() => void run(tag, false)} disabled={busy || blank}>
          Remove tag
        </button>
        <button type="button" className={buttonClass.primary} onClick={() => void run(tag, true)} disabled={busy || blank}>
          Add tag
        </button>
      </DialogActions>
    </Modal>
  );
}

interface BulkMoveDialogProps {
  count: number;
  /** Selected sessions only in this browser: they can't be in a workspace and stay where they are. */
  notInAccount: number;
  workspaces: { id: string; name: string }[];
  onClose: () => void;
  onConfirm: Confirm<[workspaceId: string | null]>;
}

export function BulkMoveDialog({ count, notInAccount, workspaces, onClose, onConfirm }: BulkMoveDialogProps) {
  const { busy, error, run } = useRun(onConfirm);
  const [target, setTarget] = useState("");
  const selectId = useId();
  return (
    <Modal title={`Move ${plural(count, "session")}`} onClose={onClose} dismissible={!busy}>
      <label htmlFor={selectId} className="text-xs font-semibold text-fg-muted">
        Workspace
      </label>
      <select id={selectId} autoFocus value={target} onChange={(event) => setTarget(event.target.value)} className={`${selectClass} mt-1 w-full`}>
        <option value="">No workspace</option>
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
      {notInAccount > 0 && (
        <p className="mt-3 text-xs text-fg-muted">
          {plural(notInAccount, "session")} only in this browser can&apos;t be in a workspace and will stay where {notInAccount === 1 ? "it is" : "they are"}.
        </p>
      )}
      <Failure error={error} what="Not moved" />
      <DialogActions>
        <button type="button" className={buttonClass.secondary} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={buttonClass.primary} onClick={() => void run(target || null)} disabled={busy}>
          Move
        </button>
      </DialogActions>
    </Modal>
  );
}
