import type { RestoreDestination } from "@sessionhub/core/restore-plan";
import { LoaderCircle } from "lucide-react";
import { buttonClass } from "../../components/modal";
import { SplitButton, type SplitButtonOption } from "../../components/split-button";
import { plural } from "../../lib/format";

const DESTINATIONS: SplitButtonOption<RestoreDestination>[] = [
  { value: "new-windows", label: "New windows, as saved" },
  { value: "one-window", label: "One new window" },
  { value: "this-window", label: "This window" },
];

const linkClass = "text-xs font-semibold text-brand hover:underline disabled:opacity-60 disabled:no-underline";

/** "in 2 new windows", "in 1 new window", "in this window". */
export const destinationText = (destination: RestoreDestination, plannedWindows: number) =>
  destination === "this-window" ? "in this window" : `in ${plural(destination === "one-window" ? 1 : plannedWindows, "new window")}`;

interface OpenBarProps {
  ticked: { tabs: number; windows: number };
  /** Tabs in the session that can reopen. */
  total: number;
  /** Tabs the click would open, and in how many windows (from the plan). */
  planned: { tabs: number; windows: number };
  destination: RestoreDestination;
  onDestination: (destination: RestoreDestination) => void;
  skipOpen: boolean;
  onSkipOpen: (skip: boolean) => void;
  /** Tabs matching the search; null without a search. */
  matches: number | null;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onSelectMatches: () => void;
  phase: "idle" | "confirm" | "running";
  onOpen: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** What is ticked, where it opens (remembered), and the Open action, with a confirm step for large opens. */
export function OpenBar({ ticked, total, planned, destination, onDestination, skipOpen, onSkipOpen, matches, phase, ...actions }: OpenBarProps) {
  const busy = phase === "running";
  const where = destinationText(destination, planned.windows);
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p aria-live="polite" className="text-xs font-semibold tabular-nums">
          {ticked.tabs === 0 ? "No tabs selected" : `${ticked.tabs} of ${plural(total, "tab")} · ${plural(ticked.windows, "window")}`}
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={linkClass} disabled={busy} onClick={actions.onSelectAll}>
            Select all
          </button>
          <button type="button" className={linkClass} disabled={busy} onClick={actions.onSelectNone}>
            Select none
          </button>
          {matches !== null && matches > 0 && (
            <button type="button" className={linkClass} disabled={busy} onClick={actions.onSelectMatches}>
              Select matches ({matches})
            </button>
          )}
        </div>
      </div>

      {phase === "confirm" ? (
        <div role="alertdialog" aria-label="Confirm opening" className="flex flex-wrap items-center justify-end gap-2 rounded-lg bg-warning-soft px-3 py-2">
          <p className="mr-auto text-[13px] font-semibold text-warning">Open {plural(planned.tabs, "tab")}?</p>
          <button type="button" className={buttonClass.secondary} onClick={actions.onCancel}>
            Cancel
          </button>
          <button type="button" className={buttonClass.primary} onClick={actions.onConfirm}>
            Open {plural(planned.tabs, "tab")}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
          {destination === "this-window" && (
            <label className="mr-auto flex items-center gap-2 text-xs select-none">
              <input type="checkbox" checked={skipOpen} disabled={busy} onChange={(event) => onSkipOpen(event.target.checked)} className="size-4 accent-[var(--sh-brand)]" />
              Skip tabs already open here
            </label>
          )}
          <SplitButton
            label={
              busy ? (
                <>
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  Opening…
                </>
              ) : (
                <span className="truncate">{planned.tabs === 0 ? "Open" : `Open ${plural(planned.tabs, "tab")} ${where}`}</span>
              )
            }
            onClick={actions.onOpen}
            disabled={busy || planned.tabs === 0}
            menuDisabled={busy}
            options={DESTINATIONS}
            value={destination}
            onSelect={onDestination}
            menuLabel="Choose where to open"
          />
        </div>
      )}
    </div>
  );
}
