import type { SavedGroup, SavedTab, SavedWindow, TabGroupColor } from "@sessionhub/contracts/session";
import { classifyUrl, displayUrl } from "@sessionhub/core/url-classification";
import { Globe, Pin } from "lucide-react";
import { plural } from "@/lib/format";

const GROUP_COLORS: Record<TabGroupColor, string> = {
  grey: "#8a948f", blue: "#3b78e7", red: "#d93b30", yellow: "#e8a500", green: "#1f8b4c",
  pink: "#d63c86", purple: "#8a4fd8", cyan: "#0f8a9d", orange: "#e5711c",
};

/** Consecutive tabs sharing a group, in saved order. */
const segments = (window: SavedWindow) => {
  const groups = new Map(window.groups.map((group) => [group.id, group]));
  const result: { key: string; group: SavedGroup | null; tabs: SavedTab[] }[] = [];
  for (const tab of window.tabs) {
    const group = (tab.groupId && groups.get(tab.groupId)) || null;
    const last = result.at(-1);
    if (last && last.group?.id === group?.id) last.tabs.push(tab);
    else result.push({ key: tab.id, group, tabs: [tab] });
  }
  return result;
};

/**
 * Only URLs the classifier calls restorable (http/https) become links, re-checked at render
 * time; everything else is plain text. Titles render as text, never HTML.
 */
function TabRow({ tab }: { tab: SavedTab }) {
  const { eligibility, reason } = classifyUrl(tab.url);
  const label = tab.title || displayUrl(tab.url);
  return (
    <li className="flex items-center gap-2.5 px-3 py-2">
      <Globe aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1">
        {eligibility === "restorable" ? (
          <a href={tab.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[13px] font-medium hover:underline" title={tab.url}>
            {label}
          </a>
        ) : (
          <span className="block truncate text-[13px] text-fg-muted" title={tab.url}>{label}</span>
        )}
        <span className="block truncate text-[11px] text-fg-muted">{displayUrl(tab.url)}</span>
      </span>
      {tab.pinned && <Pin aria-label="Pinned" className="size-3.5 shrink-0 text-fg-muted" />}
      {reason && (
        <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning">
          Won&apos;t open<span className="sr-only">: {reason}</span>
        </span>
      )}
    </li>
  );
}

export function WindowTree({ windows }: { windows: SavedWindow[] }) {
  return (
    <div className="space-y-4">
      {windows.map((window, index) => (
        <section key={window.id} aria-label={`Window ${index + 1}`} className="overflow-hidden rounded-xl border border-line bg-surface">
          <h2 className="border-b border-line bg-canvas px-3 py-2 text-xs font-semibold">
            Window {index + 1} <span className="font-normal text-fg-muted">· {plural(window.tabs.length, "tab")}</span>
          </h2>
          <div className="divide-y divide-line">
            {segments(window).map(({ key, group, tabs }) =>
              group ? (
                <div key={key} className="py-1">
                  <p className="flex items-center gap-2 px-3 pt-1.5 text-xs font-semibold">
                    <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: GROUP_COLORS[group.color] }} />
                    {group.title || "Unnamed group"} <span className="font-normal text-fg-muted">({tabs.length})</span>
                  </p>
                  <ul aria-label={`Group ${group.title || "Unnamed group"}`} className="ml-4 border-l border-line">
                    {tabs.map((tab) => <TabRow key={tab.id} tab={tab} />)}
                  </ul>
                </div>
              ) : (
                <ul key={key}>{tabs.map((tab) => <TabRow key={tab.id} tab={tab} />)}</ul>
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
