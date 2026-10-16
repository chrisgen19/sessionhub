import type { SavedGroup, SavedSession, SavedTab, SavedWindow, TabGroupColor } from "@sessionhub/contracts/session";
import { describeEligibility, displayUrl } from "@sessionhub/core/url-classification";
import { Pin } from "lucide-react";
import { TabFavicon } from "../../components/tab-favicon";
import { plural } from "../../lib/format";

const GROUP_COLORS: Record<TabGroupColor, string> = {
  grey: "#8a948f",
  blue: "#3b78e7",
  red: "#d93b30",
  yellow: "#e8a500",
  green: "#1f8b4c",
  pink: "#d63c86",
  purple: "#8a4fd8",
  cyan: "#0f8a9d",
  orange: "#e5711c",
};

interface Segment {
  key: string;
  group: SavedGroup | null;
  tabs: SavedTab[];
}

/** Splits tabs (in saved order) into consecutive runs sharing the same group. */
const toSegments = (window: SavedWindow): Segment[] => {
  const groupsById = new Map(window.groups.map((group) => [group.id, group]));
  const segments: Segment[] = [];
  for (const tab of [...window.tabs].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const group = (tab.groupId && groupsById.get(tab.groupId)) || null;
    const last = segments.at(-1);
    if (last && last.group?.id === group?.id) last.tabs.push(tab);
    else segments.push({ key: tab.id, group, tabs: [tab] });
  }
  return segments;
};

function TabRow({ tab }: { tab: SavedTab }) {
  const reason = describeEligibility(tab.eligibility);
  return (
    <li className="flex items-center gap-2.5 py-1.5 pr-1 pl-2" title={`${tab.title}\n${tab.url}`}>
      <TabFavicon url={tab.url} restorable={tab.eligibility === "restorable"} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[13px] ${reason ? "text-fg-muted" : ""}`}>{tab.title || displayUrl(tab.url)}</span>
        <span className="block truncate text-[11px] text-fg-muted">{displayUrl(tab.url)}</span>
      </span>
      {tab.pinned && <Pin aria-label="Pinned" className="size-3.5 shrink-0 text-fg-muted" />}
      {reason && (
        <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning">
          Won't restore<span className="sr-only">: {reason}</span>
        </span>
      )}
    </li>
  );
}

function SegmentView({ segment }: { segment: Segment }) {
  const rows = segment.tabs.map((tab) => <TabRow key={tab.id} tab={tab} />);
  if (!segment.group) return <ul>{rows}</ul>;
  return (
    <div className="my-1">
      <p className="flex items-center gap-2 px-2 py-1 text-xs font-semibold">
        <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: GROUP_COLORS[segment.group.color] }} />
        {segment.group.title || "Unnamed group"}
        <span className="font-normal text-fg-muted">({segment.tabs.length})</span>
      </p>
      <ul aria-label={`Group ${segment.group.title || "Unnamed group"}`} className="ml-3 border-l border-line">
        {rows}
      </ul>
    </div>
  );
}

/** Read-only window, group and tab tree for a saved session, in saved order. */
export function WindowTree({ session }: { session: SavedSession }) {
  return (
    <div className="space-y-3">
      {session.windows.map((window, index) => (
        <section key={window.id} aria-label={`Window ${index + 1}`} className="rounded-xl border border-line bg-canvas">
          <h3 className="border-b border-line px-3 py-2 text-xs font-semibold">
            Window {index + 1} <span className="font-normal text-fg-muted">· {plural(window.tabs.length, "tab")}</span>
          </h3>
          <div className="p-1">
            {toSegments(window).map((segment) => (
              <SegmentView key={segment.key} segment={segment} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
