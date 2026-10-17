import { LoaderCircle } from "lucide-react";
import type { OpenWindowsState } from "../../hooks/use-open-windows";
import { SaveBar } from "./save-bar";
import { TabPicker } from "./tab-picker";
import { useSavePicker } from "./use-save-picker";

/** Loading and error states of the open windows, shared by the popup and the Open tabs view; null once ready. */
export function OpenWindowsStatus({ open }: { open: OpenWindowsState }) {
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
  return null;
}

export function NoOpenTabs({ children = "No open tabs to save." }: { children?: string }) {
  return <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-fg-muted">{children}</p>;
}

/**
 * The popup's Save tab (docs/UI_UX_DESIGN.md 18i, 18k): open windows with checkboxes, the current
 * window ticked and expanded, then a named save of exactly the ticked tabs. The manager's Open tabs
 * view lays out the same picker its own way (`open-tabs-view.tsx`).
 */
export function SavePanel() {
  const picker = useSavePicker();
  const { open } = picker;
  if (open.status !== "ready") return <OpenWindowsStatus open={open} />;

  // The save bar sticks to the bottom of the popup's scroll area (the popup scrolls as one; no nested scroll box).
  return (
    <div className="space-y-3">
      {open.windows.length === 0 ? (
        <NoOpenTabs />
      ) : (
        <TabPicker windows={open.windows} currentWindowId={open.currentWindowId} selection={picker.selection} onChange={picker.setSelection} expandAll={false} />
      )}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-surface px-4 py-3">
        <SaveBar
          summary={picker.summary}
          name={picker.name}
          onName={picker.setName}
          destination={picker.destination}
          result={picker.result}
          onSave={() => void picker.save()}
          onSelectAll={picker.selectAll}
          onSelectNone={picker.selectNone}
        />
      </div>
    </div>
  );
}
