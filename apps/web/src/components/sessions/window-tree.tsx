import type { SavedGroup, SavedTab, SavedWindow } from "@sessionhub/contracts/session";
import { classifyUrl, displayUrl } from "@sessionhub/core/url-classification";
import { Globe, Pin } from "lucide-react";
import { plural } from "@/lib/format";
import { GROUP_COLORS } from "@/lib/group-colors";
import { hostMark } from "@/lib/host-mark";

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

/** The site's letter mark (lib/host-mark.ts); a generic icon for anything that isn't a web page. */
function SiteMark({ url }: { url: string }) {
  const mark = hostMark(url);
  if (!mark) return <Globe aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />;
  return (
    <span
      aria-hidden="true"
      className="grid size-4 shrink-0 place-items-center rounded-[4px] text-[10px] leading-none font-bold text-white"
      style={{ backgroundColor: GROUP_COLORS[mark.color] }}
    >
      {mark.letter}
    </span>
  );
}

/**
 * Only URLs the classifier calls restorable (http/https) become links, re-checked at render
 * time; everything else is plain text. Titles render as text, never HTML. Wide trees (>= 672 px)
 * put each tab on one line with the address in a fixed-width last column, as the extension does.
 */
function TabRow({ tab }: { tab: SavedTab }) {
  const { eligibility, reason } = classifyUrl(tab.url);
  const label = tab.title || displayUrl(tab.url);
  return (
    <li className="flex items-center gap-2.5 px-3 py-2 @2xl:py-1.5">
      <SiteMark url={tab.url} />
      <span className="min-w-0 flex-1 @2xl:contents">
        <span className="block min-w-0 truncate text-[13px] @2xl:flex-1">
          {eligibility === "restorable" ? (
            <a href={tab.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-brand hover:underline" title={tab.url}>
              {label}
            </a>
          ) : (
            <span className="text-fg-muted" title={tab.url}>
              {label}
            </span>
          )}
        </span>
        <span className="block truncate text-[11px] text-fg-muted @2xl:order-last @2xl:w-[30cqw] @2xl:shrink-0 @2xl:pl-4 @2xl:text-xs">{displayUrl(tab.url)}</span>
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
    <div className="@container space-y-3">
      {windows.map((window, index) => (
        <section key={window.id} aria-label={`Window ${index + 1}`} className="overflow-hidden rounded-xl border border-line bg-canvas">
          <h2 className="border-b border-line px-3 py-2 text-xs font-semibold">
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
