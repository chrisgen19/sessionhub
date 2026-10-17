import { LoaderCircle, Save } from "lucide-react";
import { useId } from "react";
import { SESSION_LIMITS } from "@sessionhub/contracts/session";
import { plural } from "../../lib/format";
import type { SelectionSummary } from "../../lib/tab-selection";

export type SaveResult =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; text: string }
  | { status: "error"; message: string };

interface SaveBarProps {
  summary: SelectionSummary;
  name: string;
  onName: (name: string) => void;
  /** Where the session goes; null while the sync state is loading. */
  destination: "local" | "account" | null;
  result: SaveResult;
  onSave: () => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

const DESTINATION = {
  local: "Saves in this browser only.",
  account: "Saves to your account: it uploads at the next sync.",
} as const;

const linkClass = "text-xs font-semibold text-brand hover:underline";

/** What will be saved, its name and destination, all stated before anything is saved. */
export function SaveBar({ summary, name, onName, destination, result, onSave, onSelectAll, onSelectNone }: SaveBarProps) {
  const nameId = useId();
  const saving = result.status === "saving";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p aria-live="polite" className="text-xs font-semibold tabular-nums">
          {summary.tabs === 0 ? "No tabs selected" : `${plural(summary.tabs, "tab")} in ${plural(summary.windows, "window")} selected`}
          {summary.browserPages > 0 && (
            <span className="font-normal text-fg-muted"> · {plural(summary.browserPages, "browser page")} kept for reference only</span>
          )}
        </p>
        <span className="flex gap-3">
          <button type="button" className={linkClass} onClick={onSelectAll}>
            Select all
          </button>
          <button type="button" className={linkClass} onClick={onSelectNone}>
            Select none
          </button>
        </span>
      </div>
      <label htmlFor={nameId} className="sr-only">
        Session name
      </label>
      <input
        id={nameId}
        value={name}
        maxLength={SESSION_LIMITS.nameMax}
        onChange={(event) => onName(event.target.value)}
        className="h-9 w-full rounded-lg border border-line bg-canvas px-3 text-[13px]"
      />
      {destination && <p className="text-[11px] text-fg-muted">{DESTINATION[destination]}</p>}
      <button
        type="button"
        disabled={saving || summary.tabs === 0 || name.trim().length === 0}
        onClick={onSave}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 text-[13px] font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
      >
        {saving ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}
        {summary.tabs === 0 ? "Save tabs" : `Save ${plural(summary.tabs, "tab")}`}
      </button>
      <div aria-live="polite">
        {result.status === "saved" && <p className="rounded-lg bg-brand-soft px-3 py-2 text-xs font-medium text-brand">{result.text}</p>}
        {result.status === "error" && (
          <p role="alert" className="flex items-center justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
            <span>Not saved: {result.message}</span>
            <button type="button" className="font-semibold underline" onClick={onSave}>
              Retry
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
