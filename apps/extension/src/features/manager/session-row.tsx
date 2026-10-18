import { Pin } from "lucide-react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { summarizeSession } from "@sessionhub/core/session-summary";
import { formatListDate, plural, sessionSourceLabel } from "../../lib/format";
import { SESSION_SYNC_TEXT, type SessionSyncLabel } from "../../lib/sync-status";
import { SessionFavicons } from "./session-favicons";

const PROBLEM = new Set<SessionSyncLabel>(["conflict", "error"]);
const TAGS_SHOWN = 3;

interface SessionRowProps {
  session: SavedSession;
  syncLabel: SessionSyncLabel;
  open: boolean;
  checked: boolean;
  /** Its workspace's name when the list shows every workspace. */
  workspaceName: string | null;
  onOpen: () => void;
  /** `range`: Shift was held, so everything since the last ticked row is ticked too. */
  onCheck: (range: boolean) => void;
}

/** One saved session: a checkbox for bulk actions, then the button that opens it. */
export function SessionRow({ session, syncLabel, open, checked, workspaceName, onOpen, onCheck }: SessionRowProps) {
  const summary = summarizeSession(session);
  const tags = session.tags ?? [];
  return (
    <li className={`flex items-stretch ${open ? "bg-brand-soft shadow-[inset_3px_0_0_var(--sh-brand)]" : checked ? "bg-surface-muted" : ""}`}>
      <label className="flex shrink-0 cursor-pointer items-center pr-1 pl-4 lg:pl-6 xl:pl-4">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheck((event.nativeEvent as MouseEvent).shiftKey === true)}
          aria-label={`Select ${session.name}`}
          className="size-4 accent-[var(--sh-brand)]"
        />
      </label>
      <button type="button" aria-current={open ? "true" : undefined} onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-4 pl-2 text-left hover:bg-surface-muted lg:pr-6 xl:pr-4">
        <SessionFavicons session={session} />
        {/* The date and sync status don't shrink, so the narrow list rail never truncates them away. */}
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex items-baseline gap-3">
            <span className="flex min-w-0 flex-1 items-center gap-1 text-[13px] font-semibold">
              {session.isPinned && (
                <>
                  <Pin aria-hidden="true" className="size-3 shrink-0 text-brand" />
                  <span className="sr-only">Pinned: </span>
                </>
              )}
              <span className="truncate" title={session.name}>
                {session.name}
              </span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-fg-muted">{formatListDate(session.updatedAt)}</span>
          </span>
          <span className="flex items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
              {workspaceName && <span className="font-semibold text-fg">{workspaceName} · </span>}
              {plural(summary.tabCount, "tab")} · {plural(summary.windowCount, "window")} · {sessionSourceLabel(session)}
            </span>
            <span className={`shrink-0 text-[11px] font-semibold ${PROBLEM.has(syncLabel) ? "text-warning" : "text-fg-muted"}`}>{SESSION_SYNC_TEXT[syncLabel]}</span>
          </span>
          {tags.length > 0 && (
            <span className="flex flex-wrap gap-1 pt-0.5">
              <span className="sr-only">Tags: </span>
              {tags.slice(0, TAGS_SHOWN).map((tag) => (
                <span key={tag} className="max-w-32 truncate rounded bg-surface-muted px-1.5 text-[11px] font-semibold text-fg-muted">
                  {tag}
                </span>
              ))}
              {tags.length > TAGS_SHOWN && <span className="text-[11px] text-fg-muted">+{tags.length - TAGS_SHOWN}</span>}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
