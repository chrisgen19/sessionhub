import type { SavedGroup, SavedSession, SavedTab } from "@sessionhub/contracts/session";
import { classifyUrl, displayUrl } from "@sessionhub/core/url-classification";
import { ChevronDown, ChevronRight, Pin } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { GROUP_COLORS } from "../../components/color-dot";
import { TabFavicon } from "../../components/tab-favicon";
import { plural } from "../../lib/format";
import { canOpen, savedWindowState, tabsInOrder, toggleSavedWindow, type SavedSelection } from "../../lib/open-selection";
import { toggleRange } from "../../lib/tab-selection";
import { toTabSegments } from "../../lib/tab-segments";

interface SavedTabTreeProps {
  session: SavedSession;
  selection: SavedSelection;
  onChange: (selection: SavedSelection) => void;
  /** Manager: every window starts expanded. Popup: only the first. */
  expandAll: boolean;
}

/** React fires a checkbox's onChange from the click, so the modifier keys are on the native event. */
const shiftHeld = (event: ChangeEvent<HTMLInputElement>) => (event.nativeEvent as MouseEvent).shiftKey === true;

const checkboxClass = "size-4 shrink-0 accent-[var(--sh-brand)] disabled:opacity-40";

/**
 * A saved tab: the box ticks it; the title is a plain link, so a click, Ctrl/Cmd-click, Shift-click
 * or middle-click opens just that page the way Chrome opens links. Tabs that can't reopen have no link.
 */
function TabRow({ tab, checked, onToggle }: { tab: SavedTab; checked: boolean; onToggle: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const { reason } = classifyUrl(tab.url);
  const title = tab.title || displayUrl(tab.url);
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-2.5 rounded-md py-1.5 pr-1 pl-2 select-none hover:bg-surface-muted" title={`${tab.title}\n${tab.url}`}>
        <input type="checkbox" checked={checked} disabled={reason !== null} onChange={onToggle} className={checkboxClass} />
        <TabFavicon url={tab.url} restorable={reason === null} />
        <span className="min-w-0 flex-1">
          {reason === null ? (
            <a href={tab.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[13px] hover:text-brand hover:underline">
              {title}
            </a>
          ) : (
            <span className="block truncate text-[13px] text-fg-muted">{title}</span>
          )}
          <span className="block truncate text-[11px] text-fg-muted">{displayUrl(tab.url)}</span>
        </span>
        {tab.pinned && <Pin aria-label="Pinned" className="size-3.5 shrink-0 text-fg-muted" />}
        {reason !== null && (
          <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning">
            Won't open<span className="sr-only">: {reason}</span>
          </span>
        )}
      </label>
    </li>
  );
}

function GroupHeading({ group, count }: { group: SavedGroup; count: number }) {
  return (
    <p className="flex items-center gap-2 px-2 py-1 text-xs font-semibold">
      <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: GROUP_COLORS[group.color] }} />
      {group.title || "Unnamed group"}
      <span className="font-normal text-fg-muted">({count})</span>
    </p>
  );
}

/**
 * A saved session's windows, groups and tabs with boxes (docs/UI_UX_DESIGN.md section 12 update): a
 * window box ticks every tab in it that can reopen, single tabs can be unticked, and Shift-click
 * ticks or unticks a range in visible order. Tabs that can't reopen are listed but can't be ticked.
 */
export function SavedTabTree({ session, selection, onChange, expandAll }: SavedTabTreeProps) {
  // Windows whose expansion differs from the default (all expanded, or only the first one).
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const expanded = (id: string, index: number) => (expandAll || index === 0) !== flipped.has(id);
  const visibleOrder = session.windows.flatMap((window, index) => (expanded(window.id, index) ? tabsInOrder(window).filter(canOpen).map((tab) => tab.id) : []));

  const toggleTab = (tabId: string) => (event: ChangeEvent<HTMLInputElement>) => {
    onChange(toggleRange(selection, visibleOrder, shiftHeld(event) ? anchor.current : null, tabId));
    anchor.current = tabId;
  };
  const flip = (id: string) =>
    setFlipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-2">
      {session.windows.map((window, index) => {
        const state = savedWindowState(window, selection);
        const open = expanded(window.id, index);
        const openable = window.tabs.filter(canOpen);
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
                  disabled={openable.length === 0}
                  ref={(input) => {
                    if (input) input.indeterminate = state === "mixed";
                  }}
                  onChange={() => onChange(toggleSavedWindow(selection, window))}
                  className={checkboxClass}
                />
                <span className="truncate text-xs font-semibold">
                  {label} <span className="font-normal text-fg-muted">· {plural(window.tabs.length, "tab")}</span>
                </span>
              </label>
              <span className="shrink-0 pr-1 text-[11px] tabular-nums text-fg-muted">
                {openable.filter((tab) => selection.has(tab.id)).length}/{openable.length}
              </span>
            </div>
            {open && (
              <div className="p-1">
                {toTabSegments(tabsInOrder(window), window.groups).map((segment) => {
                  const rows = segment.tabs.map((tab) => <TabRow key={tab.id} tab={tab} checked={selection.has(tab.id)} onToggle={toggleTab(tab.id)} />);
                  if (!segment.group) return <ul key={segment.tabs[0]?.id}>{rows}</ul>;
                  return (
                    <div key={segment.tabs[0]?.id} className="my-1">
                      <GroupHeading group={segment.group} count={segment.tabs.length} />
                      <ul aria-label={`Group ${segment.group.title || "Unnamed group"}`} className="ml-3 border-l border-line">
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
