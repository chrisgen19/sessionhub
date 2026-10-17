import type { RestoreDestination } from "@sessionhub/core/restore-plan";
import { LoaderCircle } from "lucide-react";
import { buttonClass } from "../../components/modal";
import { SplitButton, type SplitButtonOption } from "../../components/split-button";
import { plural } from "../../lib/format";

export const DESTINATIONS: SplitButtonOption<RestoreDestination>[] = [
  { value: "new-windows", label: "New windows, as saved" },
  { value: "one-window", label: "One new window" },
  { value: "this-window", label: "This window" },
];

const linkClass = "text-xs font-semibold text-brand hover:underline disabled:opacity-60 disabled:no-underline";
const checkLabelClass = "flex items-center gap-2 text-xs select-none";
const checkboxClass = "size-4 accent-[var(--sh-brand)]";

/** Without counts, for a hint: "in new windows", "in one new window", "in this window". */
export const DESTINATION_PHRASE: Record<RestoreDestination, string> = {
  "new-windows": "in new windows",
  "one-window": "in one new window",
  "this-window": "in this window",
};

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
  lazy: boolean;
  onLazy: (lazy: boolean) => void;
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
export function OpenBar({ ticked, total, planned, destination, onDestination, skipOpen, onSkipOpen, lazy, onLazy, matches, phase, ...actions }: OpenBarProps) {
  const busy = phase === "running";
  const where = destinationText(destination, planned.windows);
  // Wide containers (the manager's inspector) put the selection and the open controls in one row;
  // the controls wrap under it, right-aligned, when they don't fit. Narrow ones (the popup) stack them.
  return (
    <div className="@container">
      <div className="space-y-2.5 @2xl:flex @2xl:flex-wrap @2xl:items-center @2xl:gap-x-6 @2xl:gap-y-2.5 @2xl:space-y-0">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 @2xl:justify-start @2xl:gap-x-4">
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
          <div role="alertdialog" aria-label="Confirm opening" className="flex flex-wrap items-center justify-end gap-2 rounded-lg bg-warning-soft px-3 py-2 @2xl:flex-1">
            <p className="mr-auto text-[13px] font-semibold text-warning">Open {plural(planned.tabs, "tab")}?</p>
            <button type="button" className={buttonClass.secondary} onClick={actions.onCancel}>
              Cancel
            </button>
            <button type="button" className={buttonClass.primary} onClick={actions.onConfirm}>
              Open {plural(planned.tabs, "tab")}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 @2xl:ml-auto @2xl:gap-x-4">
            <div className="mr-auto flex flex-col gap-1 @2xl:mr-0">
              {destination === "this-window" && (
                <label className={checkLabelClass}>
                  <input type="checkbox" checked={skipOpen} disabled={busy} onChange={(event) => onSkipOpen(event.target.checked)} className={checkboxClass} />
                  Skip tabs already open here
                </label>
              )}
              <label className={checkLabelClass} title="Each page starts loading, then is unloaded to save memory. It loads again when you click its tab.">
                <input type="checkbox" checked={lazy} disabled={busy} onChange={(event) => onLazy(event.target.checked)} className={checkboxClass} />
                Keep tabs unloaded until clicked
              </label>
            </div>
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
    </div>
  );
}
