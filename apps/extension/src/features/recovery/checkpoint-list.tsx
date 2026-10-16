import { History } from "lucide-react";
import { diffSnapshotUrls } from "@sessionhub/core/recovery";
import type { RecoverySnapshotRecord } from "../../lib/db";
import { dateBucket, formatListDate, formatTime, plural, type DateBucket } from "../../lib/format";

const urlsOf = (snapshot: RecoverySnapshotRecord) => snapshot.session.windows.flatMap((window) => window.tabs.map((tab) => tab.url));

/** "3 opened, 1 closed" relative to the previous (older) checkpoint. */
const changeSummary = (snapshot: RecoverySnapshotRecord, previous: RecoverySnapshotRecord | undefined): string | null => {
  if (!previous) return null;
  const { added, removed } = diffSnapshotUrls(urlsOf(previous), urlsOf(snapshot));
  const parts = [added > 0 ? `${added} opened` : null, removed > 0 ? `${removed} closed` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Rearranged";
};

interface CheckpointListProps {
  snapshots: RecoverySnapshotRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Newest-first checkpoints grouped Today / Yesterday / Previous 7 days / Older. */
export function CheckpointList({ snapshots, selectedId, onSelect }: CheckpointListProps) {
  const groups = new Map<DateBucket, { snapshot: RecoverySnapshotRecord; previous: RecoverySnapshotRecord | undefined }[]>();
  snapshots.forEach((snapshot, index) => {
    const bucket = dateBucket(snapshot.capturedAt);
    groups.set(bucket, [...(groups.get(bucket) ?? []), { snapshot, previous: snapshots[index + 1] }]);
  });

  return (
    <div className="bg-surface">
      {[...groups].map(([bucket, items]) => (
        <section key={bucket} aria-label={bucket}>
          <h2 className="border-b border-line bg-canvas px-4 py-1.5 text-[11px] font-semibold tracking-wide text-fg-muted uppercase lg:px-6">{bucket}</h2>
          <ul className="divide-y divide-line">
            {items.map(({ snapshot, previous }) => {
              const selected = snapshot.id === selectedId;
              const change = changeSummary(snapshot, previous);
              return (
                <li key={snapshot.id}>
                  <button
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onSelect(snapshot.id)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted lg:px-6 ${
                      selected ? "bg-brand-soft shadow-[inset_3px_0_0_var(--sh-brand)]" : ""
                    }`}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-muted text-fg-muted">
                      <History aria-hidden="true" className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold tabular-nums">
                        {bucket === "Today" || bucket === "Yesterday" ? formatTime(snapshot.capturedAt) : formatListDate(snapshot.capturedAt)}
                        {snapshot.reason === "manual" && <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-fg-muted">Manual</span>}
                      </span>
                      <span className="block truncate text-xs text-fg-muted">
                        {plural(snapshot.windowCount, "window")} · {plural(snapshot.tabCount, "tab")}
                        {change ? ` · ${change}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
