import type { CaptureWindowInput } from "./capture";

/** Default retention for automatic checkpoints (docs/DATA_MODEL.md section 7). */
export const RECOVERY_RETENTION = { maxCount: 50, maxAgeDays: 7 } as const;
export type RetentionPolicy = { maxCount: number; maxAgeDays: number };

/** 32-bit FNV-1a over a string with a given offset basis. */
const fnv1a = (text: string, basis: number): string => {
  let hash = basis;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

/**
 * Fingerprint of the *material* browser state: window structure, tab URLs and order,
 * pinned state and group membership/title/color. Titles, collapsed state and runtime
 * ids are ignored so badge counts ("(3) Inbox") don't create new checkpoints.
 */
export const fingerprintCapture = (windows: readonly CaptureWindowInput[]): string => {
  const canonical = JSON.stringify(
    windows.map((window) => {
      const groups = new Map(window.groups.map((group) => [group.key, `${group.title}|${group.color}`]));
      return [...window.tabs]
        .sort((a, b) => a.index - b.index)
        .map((tab) => [tab.url, tab.pinned ? 1 : 0, tab.groupKey === null ? null : (groups.get(tab.groupKey) ?? "?")]);
    }),
  );
  return `${fnv1a(canonical, 0x811c9dc5)}${fnv1a(canonical, 0x01000193)}-${canonical.length}`;
};

export interface SnapshotMeta {
  id: string;
  capturedAt: string;
  tabCount: number;
}

/**
 * Ids to evict. Keeps at most `maxCount` snapshots no older than `maxAgeDays`, and
 * always keeps (1) the newest snapshot, whatever its age, and (2) the largest snapshot
 * within the age window, so a burst of small snapshots after an accidental mass-close
 * can't push out the last good state.
 */
export const selectSnapshotsToEvict = (
  snapshots: readonly SnapshotMeta[],
  now: Date,
  policy: RetentionPolicy = RECOVERY_RETENTION,
): string[] => {
  const newestFirst = [...snapshots].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  const cutoff = now.getTime() - policy.maxAgeDays * 24 * 60 * 60 * 1000;
  const recent = newestFirst.filter((snapshot) => Date.parse(snapshot.capturedAt) >= cutoff);
  const largest = recent.reduce<SnapshotMeta | undefined>(
    (best, snapshot) => (best === undefined || snapshot.tabCount > best.tabCount ? snapshot : best),
    undefined,
  );

  const keep = new Set<string>();
  if (newestFirst[0]) keep.add(newestFirst[0].id);
  if (largest) keep.add(largest.id);
  for (const snapshot of recent) {
    if (keep.size >= policy.maxCount) break;
    keep.add(snapshot.id);
  }
  return newestFirst.filter((snapshot) => !keep.has(snapshot.id)).map((snapshot) => snapshot.id);
};

/** URL-level change between two checkpoints (multiset, so duplicates count). */
export const diffSnapshotUrls = (previous: readonly string[], current: readonly string[]): { added: number; removed: number } => {
  const counts = new Map<string, number>();
  for (const url of previous) counts.set(url, (counts.get(url) ?? 0) + 1);
  let added = 0;
  for (const url of current) {
    const remaining = counts.get(url) ?? 0;
    if (remaining > 0) counts.set(url, remaining - 1);
    else added += 1;
  }
  const removed = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return { added, removed };
};
