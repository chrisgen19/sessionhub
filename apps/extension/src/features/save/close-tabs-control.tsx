import { LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { buttonClass } from "../../components/modal";
import { plural } from "../../lib/format";

type Phase = { name: "idle" } | { name: "confirm" } | { name: "closing" } | { name: "done"; text: string };

interface CloseTabsControlProps {
  /** Ticked tabs. */
  count: number;
  /** Save and close needs what Save needs: a name and a known destination. */
  canSave: boolean;
  /** Closes the ticked tabs; resolves to how many closed. */
  onClose: () => Promise<number>;
  /** Saves the ticked tabs, then closes them; null when the save failed, so nothing was closed. */
  onSaveAndClose: () => Promise<number | null>;
}

/**
 * Closing the ticked tabs, which asks first in place (AGENTS.md: destructive browser actions need
 * clear, in-context consent) and offers saving them as a session on the way out.
 */
export function CloseTabsControl({ count, canSave, onClose, onSaveAndClose }: CloseTabsControlProps) {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const run = async (action: () => Promise<number | null>) => {
    setPhase({ name: "closing" });
    const closed = await action();
    // A failed save shows its own error in the save bar.
    setPhase(closed === null ? { name: "idle" } : { name: "done", text: `Closed ${plural(closed, "tab")}.` });
  };

  if (phase.name === "confirm" || phase.name === "closing") {
    const busy = phase.name === "closing";
    return (
      <div role="alertdialog" aria-label="Confirm closing" className="space-y-2.5 rounded-lg bg-danger-soft p-3">
        <p className="text-[13px] font-semibold text-danger">Close {plural(count, "tab")}?</p>
        <p className="text-xs text-fg">To keep them as a session, save them first. Closed pages stay in Chrome&apos;s history.</p>
        {/* Buttons share each row, so a narrow panel wraps them into even rows instead of a stray one. */}
        <div className="flex flex-wrap gap-2 [&>button]:flex-1 [&>button]:whitespace-nowrap">
          <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => setPhase({ name: "idle" })}>
            Cancel
          </button>
          <button type="button" className={buttonClass.secondary} disabled={busy || !canSave || count === 0} onClick={() => void run(onSaveAndClose)}>
            Save and close
          </button>
          <button type="button" className={buttonClass.danger} disabled={busy || count === 0} onClick={() => void run(onClose)}>
            {busy && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
            Close {plural(count, "tab")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button type="button" className={`${buttonClass.ghostDanger} -ml-3`} disabled={count === 0} onClick={() => setPhase({ name: "confirm" })}>
        <X aria-hidden="true" className="size-4" />
        {count === 0 ? "Close tabs" : `Close ${plural(count, "tab")}…`}
      </button>
      {phase.name === "done" && (
        <p role="status" className="text-xs text-fg-muted">
          {phase.text}
        </p>
      )}
    </div>
  );
}
