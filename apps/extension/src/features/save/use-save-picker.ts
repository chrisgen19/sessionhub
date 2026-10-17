import { selectionSessionName } from "@sessionhub/core/naming";
import type { CaptureReport } from "@sessionhub/core/capture";
import { useState } from "react";
import { useOpenWindows, type OpenWindowsState } from "../../hooks/use-open-windows";
import { useSyncOverview } from "../../hooks/use-sync";
import { plural } from "../../lib/format";
import { sendCommand } from "../../lib/message-client";
import { initialSelection, reconcile, selectAll, summarize, type OpenWindow, type SelectionSummary, type TabSelection } from "../../lib/tab-selection";
import type { SaveResult } from "./save-bar";

/** What a save did, in plain words: where it went, browser pages kept as reference, ticked tabs that closed. */
export const savedMessage = (report: CaptureReport, syncing: boolean, missing: number): string => {
  const pages = Object.values(report.notRestorable).reduce((sum, count) => sum + count, 0);
  const counts = `${plural(report.tabCount, "tab")} in ${plural(report.windowCount, "window")}`;
  return [
    syncing ? `Saved: ${counts}. It will sync to your account.` : `Saved locally: ${counts}.`,
    pages > 0 ? `${plural(pages, "browser page")} saved as reference only.` : "",
    missing > 0 ? `${plural(missing, "tab")} closed before saving, so ${missing === 1 ? "it wasn't" : "they weren't"} saved.` : "",
  ]
    .filter(Boolean)
    .join(" ");
};

export interface SavePicker {
  open: OpenWindowsState;
  /** The open windows once read, otherwise none. */
  windows: OpenWindow[];
  selection: TabSelection;
  setSelection: (selection: TabSelection) => void;
  summary: SelectionSummary;
  name: string;
  setName: (name: string) => void;
  /** Where a save goes; null while the sync state is loading. */
  destination: "local" | "account" | null;
  result: SaveResult;
  /** Saves exactly the ticked tabs; true when saved. The selection then returns to the default. */
  save: () => Promise<boolean>;
  selectAll: () => void;
  selectNone: () => void;
}

/**
 * The save picker's state (docs/UI_UX_DESIGN.md 18i): the live open windows, the ticked tabs (the
 * current window's web pages at first), the name, and the save itself. Shared by the popup's Save
 * tab and the manager's Open tabs view, which lay it out differently.
 */
export function useSavePicker(): SavePicker {
  const open = useOpenWindows();
  const overview = useSyncOverview();
  const [selection, setSelection] = useState<TabSelection>(new Set());
  const [seen, setSeen] = useState<OpenWindow[] | null>(null);
  // null: the default name, which follows the selection; a string once the user edits it.
  const [customName, setCustomName] = useState<string | null>(null);
  const [result, setResult] = useState<SaveResult>({ status: "idle" });

  // The open tabs changed: the first load ticks the current window, later loads drop closed tabs.
  if (open.status === "ready" && open.windows !== seen) {
    setSeen(open.windows);
    setSelection(seen === null ? initialSelection(open.windows, open.currentWindowId) : reconcile(selection, open.windows, seen));
  }

  const windows = open.status === "ready" ? open.windows : [];
  const summary = summarize(selection, windows);
  const name = customName ?? selectionSessionName(Math.max(1, summary.windows), new Date());

  const save = async () => {
    setResult({ status: "saving" });
    const response = await sendCommand({ type: "session.capture", scope: { kind: "tabs", tabIds: [...selection] }, name });
    if (!response.ok) {
      setResult({ status: "error", message: response.error.message });
      return false;
    }
    setResult({ status: "saved", text: savedMessage(response.data.report, response.data.syncing, response.data.missing) });
    setSelection(initialSelection(windows, open.status === "ready" ? open.currentWindowId : null));
    setCustomName(null);
    return true;
  };

  return {
    open,
    windows,
    selection,
    setSelection,
    summary,
    name,
    setName: setCustomName,
    destination: overview === null ? null : overview.kind === "on" ? "account" : "local",
    result,
    save,
    selectAll: () => setSelection(selectAll(windows)),
    selectNone: () => setSelection(new Set()),
  };
}
