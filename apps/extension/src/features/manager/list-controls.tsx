import { useId } from "react";
import type { SessionSort } from "@sessionhub/core/session-organize";
import type { ListView } from "../../hooks/use-session-list";
import { selectClass } from "../workspaces/workspace-fields";

const SORT_LABELS: Record<SessionSort, string> = {
  updated: "Recently changed",
  oldest: "Oldest first",
  name: "Name, A to Z",
  tabs: "Most tabs",
};

interface ListControlsProps {
  view: ListView;
  counts: Record<ListView, number>;
  onView: (view: ListView) => void;
  sort: SessionSort;
  onSort: (sort: SessionSort) => void;
  /** Tags of the sessions in this view, with counts; the filter shows only when there are some. */
  tags: { tag: string; count: number }[];
  tag: string | null;
  onTag: (tag: string | null) => void;
}

/** Active or Archived, the sort (pinned sessions always first) and the tag filter, above the list. */
export function ListControls({ view, counts, onView, sort, onSort, tags, tag, onTag }: ListControlsProps) {
  const sortId = useId();
  const tagId = useId();
  const segment = (value: ListView, label: string) => (
    <button
      type="button"
      aria-pressed={view === value}
      onClick={() => onView(value)}
      className={`h-7 rounded-md px-2.5 text-xs font-semibold tabular-nums ${view === value ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"}`}
    >
      {label} {counts[value]}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div role="group" aria-label="Show" className="flex rounded-lg bg-surface-muted p-0.5">
        {segment("active", "Active")}
        {segment("archived", "Archived")}
      </div>
      {/* The labels are for screen readers: "Recently changed" and "All tags" already say what they are, and the rail is narrow. */}
      <label htmlFor={sortId} className="sr-only">
        Sort
      </label>
      <select id={sortId} title="Sort" value={sort} onChange={(event) => onSort(event.target.value as SessionSort)} className={`${selectClass} h-8`}>
        {Object.entries(SORT_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {tags.length > 0 && (
        <>
          <label htmlFor={tagId} className="sr-only">
            Tag
          </label>
          <select id={tagId} title="Tag" value={tag ?? ""} onChange={(event) => onTag(event.target.value || null)} className={`${selectClass} h-8 max-w-40 min-w-0`}>
            <option value="">All tags</option>
            {tags.map((entry) => (
              <option key={entry.tag} value={entry.tag}>
                {entry.tag} ({entry.count})
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
