import { ChevronDown, ChevronRight } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { GROUP_COLORS } from "../../components/color-dot";
import { plural } from "../../lib/format";
import { toggleRange, toggleWindow, windowState, type OpenTab, type OpenWindow, type TabSelection } from "../../lib/tab-selection";
import { toTabSegments } from "../../lib/tab-segments";
import { checkboxClass, OpenTabRow } from "./open-tab-row";

interface TabPickerProps {
  windows: OpenWindow[];
  currentWindowId: number | null;
  selection: TabSelection;
  onChange: (selection: TabSelection) => void;
  /** Manager: every window starts expanded. Popup: only the current one. */
  expandAll: boolean;
  /** The search's matches: only these tabs (and their windows) are listed, expanded. Null lists everything. */
  visible?: ReadonlySet<number> | null;
  duplicates?: ReadonlySet<number>;
  /** Manager only: switch to a tab from its title, close one from its ✕. */
  onGoTo?: (tab: OpenTab, windowId: number) => void;
  onClose?: (tab: OpenTab) => void;
}

/** React fires a checkbox's onChange from the click, so the modifier keys are on the native event. */
const shiftHeld = (event: ChangeEvent<HTMLInputElement>) => (event.nativeEvent as MouseEvent).shiftKey === true;

const NONE: ReadonlySet<number> = new Set();

/**
 * Open windows and their tabs with checkboxes (docs/UI_UX_DESIGN.md 18i, 18m): a window header ticks
 * its tabs, single tabs can be unticked, and Shift-click ticks or unticks a range in visible order.
 * Windows keep their number ("Window 2") while a search hides others.
 */
export function TabPicker({ windows, currentWindowId, selection, onChange, expandAll, visible = null, duplicates = NONE, onGoTo, onClose }: TabPickerProps) {
  // Windows whose expansion differs from the default (all expanded, or only the current one; all while searching).
  const [flipped, setFlipped] = useState<ReadonlySet<number>>(new Set());
  const anchor = useRef<number | null>(null);
  const expanded = (id: number) => (expandAll || visible !== null || id === currentWindowId) !== flipped.has(id);
  const shown = (tab: OpenTab) => visible === null || visible.has(tab.id);
  const visibleOrder = windows.filter((window) => expanded(window.id)).flatMap((window) => window.tabs.filter(shown).map((tab) => tab.id));

  const toggleTab = (tabId: number) => (event: ChangeEvent<HTMLInputElement>) => {
    onChange(toggleRange(selection, visibleOrder, shiftHeld(event) ? anchor.current : null, tabId));
    anchor.current = tabId;
  };
  const flip = (id: number) =>
    setFlipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="@container space-y-2">
      {windows.map((window, index) => {
        const tabs = window.tabs.filter(shown);
        if (tabs.length === 0) return null;
        const state = windowState(window, selection);
        const open = expanded(window.id);
        const ticked = window.tabs.filter((tab) => selection.has(tab.id)).length;
        const label = `Window ${index + 1}`;
        const row = (tab: OpenTab) => (
          <OpenTabRow
            key={tab.id}
            tab={tab}
            checked={selection.has(tab.id)}
            onToggle={toggleTab(tab.id)}
            duplicate={duplicates.has(tab.id)}
            onGoTo={onGoTo && (() => onGoTo(tab, window.id))}
            onClose={onClose && (() => onClose(tab))}
          />
        );
        return (
          <section key={window.id} aria-label={label} className="rounded-lg border border-line bg-canvas">
            <div className={`flex items-center gap-1.5 px-1.5 py-1.5 ${open ? "border-b border-line" : ""}`}>
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${open ? "Hide" : "Show"} the tabs of ${label}`}
                onClick={() => flip(window.id)}
                className="grid size-6 shrink-0 place-items-center rounded text-fg-muted hover:bg-surface-muted"
              >
                {open ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
              </button>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={state === "checked"}
                  ref={(input) => {
                    if (input) input.indeterminate = state === "mixed";
                  }}
                  onChange={() => onChange(toggleWindow(selection, window))}
                  className={checkboxClass}
                />
                <span className="truncate text-xs font-semibold">
                  {label} <span className="font-normal text-fg-muted">· {plural(window.tabs.length, "tab")}</span>
                  {visible !== null && <span className="font-normal text-fg-muted">, {tabs.length} matching</span>}
                </span>
                {window.id === currentWindowId && (
                  <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand">This window</span>
                )}
              </label>
              <span className="shrink-0 pr-1 text-[11px] tabular-nums text-fg-muted">
                {ticked}/{window.tabs.length}
              </span>
            </div>
            {open && (
              <div className="p-1">
                {toTabSegments(tabs, window.groups).map((segment) => {
                  const rows = segment.tabs.map(row);
                  if (!segment.group) return <ul key={segment.tabs[0]?.id}>{rows}</ul>;
                  const title = segment.group.title || "Unnamed group";
                  return (
                    <div key={segment.tabs[0]?.id} className="my-1">
                      <p className="flex items-center gap-2 px-2 py-1 text-xs font-semibold">
                        <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: GROUP_COLORS[segment.group.color as keyof typeof GROUP_COLORS] ?? GROUP_COLORS.grey }} />
                        {title}
                        <span className="font-normal text-fg-muted">({segment.tabs.length})</span>
                      </p>
                      <ul aria-label={`Group ${title}`} className="ml-3 border-l border-line">
                        {rows}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
