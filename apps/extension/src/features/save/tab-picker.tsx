import { describeEligibility, displayUrl } from "@sessionhub/core/url-classification";
import { ChevronDown, ChevronRight, Pin } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { GROUP_COLORS } from "../../components/color-dot";
import { TabFavicon } from "../../components/tab-favicon";
import { plural } from "../../lib/format";
import { toggleRange, toggleWindow, windowState, type OpenTab, type OpenWindow, type TabSelection } from "../../lib/tab-selection";
import { toTabSegments } from "../../lib/tab-segments";

interface TabPickerProps {
  windows: OpenWindow[];
  currentWindowId: number | null;
  selection: TabSelection;
  onChange: (selection: TabSelection) => void;
  /** Manager: every window starts expanded. Popup: only the current one. */
  expandAll: boolean;
}

/** React fires a checkbox's onChange from the click, so the modifier keys are on the native event. */
const shiftHeld = (event: ChangeEvent<HTMLInputElement>) => (event.nativeEvent as MouseEvent).shiftKey === true;

const checkboxClass = "size-4 shrink-0 accent-[var(--sh-brand)]";

function TabRow({ tab, checked, onToggle }: { tab: OpenTab; checked: boolean; onToggle: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const reason = describeEligibility(tab.eligibility);
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-2.5 rounded-md py-1.5 pr-1 pl-2 select-none hover:bg-surface-muted" title={`${tab.title}\n${tab.url}`}>
        <input type="checkbox" checked={checked} onChange={onToggle} className={checkboxClass} />
        <TabFavicon url={tab.url} restorable={tab.eligibility === "restorable"} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[13px] ${reason ? "text-fg-muted" : ""}`}>{tab.title || displayUrl(tab.url)}</span>
          <span className="block truncate text-[11px] text-fg-muted">{displayUrl(tab.url)}</span>
        </span>
        {tab.pinned && <Pin aria-label="Pinned" className="size-3.5 shrink-0 text-fg-muted" />}
        {reason && (
          <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning">
            Won't reopen<span className="sr-only">: {reason}</span>
          </span>
        )}
      </label>
    </li>
  );
}

/**
 * Open windows and their tabs with checkboxes (docs/UI_UX_DESIGN.md 18i): a window header ticks its
 * tabs, single tabs can be unticked, and Shift-click ticks or unticks a range in visible order.
 */
export function TabPicker({ windows, currentWindowId, selection, onChange, expandAll }: TabPickerProps) {
  // Windows whose expansion differs from the default (all expanded, or only the current one).
  const [flipped, setFlipped] = useState<ReadonlySet<number>>(new Set());
  const anchor = useRef<number | null>(null);
  const expanded = (id: number) => (expandAll || id === currentWindowId) !== flipped.has(id);
  const visibleOrder = windows.filter((window) => expanded(window.id)).flatMap((window) => window.tabs.map((tab) => tab.id));

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
    <div className="space-y-2">
      {windows.map((window, index) => {
        const state = windowState(window, selection);
        const open = expanded(window.id);
        const ticked = window.tabs.filter((tab) => selection.has(tab.id)).length;
        const label = `Window ${index + 1}`;
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
                {toTabSegments(window.tabs, window.groups).map((segment) => {
                  const rows = segment.tabs.map((tab) => <TabRow key={tab.id} tab={tab} checked={selection.has(tab.id)} onToggle={toggleTab(tab.id)} />);
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
