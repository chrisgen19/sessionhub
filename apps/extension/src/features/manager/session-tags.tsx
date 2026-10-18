import { X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { SESSION_LIMITS, type SavedSession } from "@sessionhub/contracts/session";
import { useSessionEdit } from "../../hooks/use-session-edit";

interface SessionTagsProps {
  session: SavedSession;
  /** Every tag in use, offered as the user types. */
  suggestions: string[];
}

/** The session's tags: remove one with its ✕, add one by typing it (Enter). */
export function SessionTags({ session, suggestions }: SessionTagsProps) {
  const { busy, error, edit } = useSessionEdit(session);
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const listId = useId();
  const tags = session.tags ?? [];
  const full = tags.length >= SESSION_LIMITS.tagsMax;
  const offered = suggestions.filter((suggestion) => !tags.some((tag) => tag.toLowerCase() === suggestion.toLowerCase()));

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim().length === 0) return;
    if (await edit({ tags: [...tags, draft] })) setDraft("");
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-fg-muted">Tags</span>
        {tags.map((tag) => (
          <span key={tag} className="inline-flex max-w-full items-center gap-0.5 rounded-md bg-surface-muted py-0.5 pr-0.5 pl-2 text-xs font-semibold">
            <span className="truncate">{tag}</span>
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              disabled={busy}
              onClick={() => void edit({ tags: tags.filter((own) => own !== tag) })}
              className="grid size-5 shrink-0 place-items-center rounded text-fg-muted hover:bg-line hover:text-fg"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </span>
        ))}
        {!full && (
          <form onSubmit={(event) => void add(event)} className="flex items-center gap-1">
            <label htmlFor={inputId} className="sr-only">
              Add a tag
            </label>
            <input
              id={inputId}
              list={listId}
              value={draft}
              disabled={busy}
              maxLength={SESSION_LIMITS.tagMax}
              placeholder="Add tag"
              onChange={(event) => setDraft(event.target.value)}
              className="h-7 w-28 rounded-md border border-line bg-canvas px-2 text-xs placeholder:text-fg-muted"
            />
            <datalist id={listId}>
              {offered.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
            {draft.trim().length > 0 && (
              <button type="submit" disabled={busy} className="h-7 rounded-md px-2 text-xs font-semibold text-brand hover:bg-surface-muted">
                Add
              </button>
            )}
          </form>
        )}
      </div>
      {full && <p className="text-xs text-fg-muted">A session can have up to {SESSION_LIMITS.tagsMax} tags.</p>}
      {error && (
        <p role="alert" className="text-xs text-danger">
          Tags not saved: {error}
        </p>
      )}
    </div>
  );
}
