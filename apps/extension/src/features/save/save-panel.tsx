import { selectionSessionName } from "@sessionhub/core/naming";
import type { CaptureReport } from "@sessionhub/core/capture";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useOpenWindows } from "../../hooks/use-open-windows";
import { useSyncOverview } from "../../hooks/use-sync";
import { plural } from "../../lib/format";
import { sendCommand } from "../../lib/message-client";
import { initialSelection, reconcile, selectAll, summarize, type OpenWindow, type TabSelection } from "../../lib/tab-selection";
import { SaveBar, type SaveResult } from "./save-bar";
import { TabPicker } from "./tab-picker";

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

/**
 * The save picker (docs/UI_UX_DESIGN.md 18i): open windows with checkboxes, the current window
 * ticked, then a named save of exactly the ticked tabs. Used by the popup and the manager.
 */
export function SavePanel({ variant }: { variant: "popup" | "page" }) {
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

  if (open.status === "loading") {
    return (
      <p aria-busy="true" className="flex items-center gap-2 py-3 text-xs text-fg-muted">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Reading your open tabs…
      </p>
    );
  }
  if (open.status === "error") {
    return (
      <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
        Couldn&apos;t read your open tabs: {open.message}
      </p>
    );
  }

  const summary = summarize(selection, open.windows);
  const name = customName ?? selectionSessionName(Math.max(1, summary.windows), new Date());
  const save = async () => {
    setResult({ status: "saving" });
    const response = await sendCommand({ type: "session.capture", scope: { kind: "tabs", tabIds: [...selection] }, name });
    if (!response.ok) {
      setResult({ status: "error", message: response.error.message });
      return;
    }
    setResult({ status: "saved", text: savedMessage(response.data.report, response.data.syncing, response.data.missing) });
    setSelection(initialSelection(open.windows, open.currentWindowId));
    setCustomName(null);
  };

  const picker =
    open.windows.length === 0 ? (
      <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-fg-muted">No open tabs to save.</p>
    ) : (
      <div className={variant === "popup" ? "max-h-[260px] overflow-y-auto pr-1" : ""}>
        <TabPicker windows={open.windows} currentWindowId={open.currentWindowId} selection={selection} onChange={setSelection} expandAll={variant === "page"} />
      </div>
    );
  const bar = (
    <SaveBar
      summary={summary}
      name={name}
      onName={setCustomName}
      destination={overview === null ? null : overview.kind === "on" ? "account" : "local"}
      result={result}
      onSave={() => void save()}
      onSelectAll={() => setSelection(selectAll(open.windows))}
      onSelectNone={() => setSelection(new Set())}
    />
  );
  // On the full page the save bar stays in view above a long list; in the popup it follows the list.
  return variant === "page" ? (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 rounded-xl border border-line bg-surface p-4 shadow-sm">{bar}</div>
      {picker}
    </div>
  ) : (
    <div className="space-y-3">
      {picker}
      {bar}
    </div>
  );
}
