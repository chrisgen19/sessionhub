import { AlertTriangle, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { planRestore } from "@sessionhub/core/restore-plan";
import { DialogActions, Modal, buttonClass } from "../../components/modal";
import type { RestoreJobRecord } from "../../lib/db";
import { formatFullDate, plural, sessionOrigin } from "../../lib/format";
import { sendCommand } from "../../lib/message-client";
import { RestoreSummary, SkippedList } from "./restore-summary";

type Phase = { name: "preview" } | { name: "running" } | { name: "done"; job: RestoreJobRecord } | { name: "error"; message: string };

/**
 * Safety-critical restore preview (docs/UI_UX_DESIGN.md section 12): new windows only,
 * per-window selection, skipped tabs listed before anything opens.
 */
export function RestoreDialog({ session, onClose }: { session: SavedSession; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ name: "preview" });
  const [selectedWindows, setSelectedWindows] = useState(() => new Set(session.windows.map((window) => window.id)));

  const selectedTabIds = useMemo(
    () => new Set(session.windows.filter((window) => selectedWindows.has(window.id)).flatMap((window) => window.tabs.map((tab) => tab.id))),
    [session, selectedWindows],
  );
  const plan = useMemo(() => planRestore(session, { tabIds: selectedTabIds }), [session, selectedTabIds]);
  const allSelected = selectedWindows.size === session.windows.length;

  const toggle = (windowId: string) =>
    setSelectedWindows((current) => {
      const next = new Set(current);
      if (next.has(windowId)) next.delete(windowId);
      else next.add(windowId);
      return next;
    });

  const start = async () => {
    setPhase({ name: "running" });
    const response = await sendCommand({
      type: "restore.start",
      sessionId: session.id,
      ...(allSelected ? {} : { tabIds: [...selectedTabIds] }),
    });
    setPhase(response.ok ? { name: "done", job: response.data.job } : { name: "error", message: response.error.message });
  };

  return (
    <Modal title={`Restore "${session.name}"`} onClose={onClose} dismissible={phase.name !== "running"}>
      <p className="text-xs text-fg-muted">
        {sessionOrigin(session)} · {plural(session.windows.length, "window")} · saved {formatFullDate(session.updatedAt)}
      </p>

      {phase.name === "preview" && (
        <>
          <p className="mt-4 rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand">
            Opens in new windows. Your current windows and tabs stay as they are.
          </p>
          <fieldset className="mt-4">
            <legend className="mb-2 text-xs font-semibold">Windows to open</legend>
            <div className="space-y-1.5">
              {session.windows.map((window, index) => (
                <label key={window.id} className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-[13px]">
                  <input type="checkbox" className="size-4 accent-brand" checked={selectedWindows.has(window.id)} onChange={() => toggle(window.id)} />
                  Window {index + 1}
                  <span className="ml-auto text-xs tabular-nums text-fg-muted">{plural(window.tabs.length, "tab")}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {plan.skipped.length > 0 && (
            <div className="mt-4 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle aria-hidden="true" className="size-4" />
                {plural(plan.skipped.length, "tab")} can't be restored
              </p>
              <SkippedList skipped={plan.skipped} />
            </div>
          )}
          <DialogActions>
            <button type="button" className={buttonClass.secondary} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={buttonClass.primary} disabled={plan.tabCount === 0} onClick={() => void start()}>
              Restore {plural(plan.tabCount, "tab")}
            </button>
          </DialogActions>
        </>
      )}

      {phase.name === "running" && (
        <p role="status" className="mt-5 flex items-center gap-2 text-[13px]">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          Opening {plural(plan.tabCount, "tab")} in new windows…
        </p>
      )}

      {phase.name === "done" && <RestoreSummary session={session} job={phase.job} onClose={onClose} />}

      {phase.name === "error" && (
        <>
          <p role="alert" className="mt-5 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            Restore didn't start: {phase.message}
          </p>
          <DialogActions>
            <button type="button" className={buttonClass.secondary} onClick={onClose}>
              Close
            </button>
          </DialogActions>
        </>
      )}
    </Modal>
  );
}
