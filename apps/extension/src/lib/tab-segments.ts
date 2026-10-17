/** A run of consecutive tabs sharing one tab group (null: not in a group). */
export interface TabSegment<T, G> {
  group: G | null;
  tabs: T[];
}

/**
 * Splits tabs, already in display order, into consecutive runs sharing the same group, for the
 * saved-session tree and the save picker alike.
 */
export const toTabSegments = <K, T extends { groupId: K | null }, G extends { id: K }>(tabs: T[], groups: G[]): TabSegment<T, G>[] => {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const segments: TabSegment<T, G>[] = [];
  for (const tab of tabs) {
    const group = (tab.groupId !== null && groupsById.get(tab.groupId)) || null;
    const last = segments.at(-1);
    if (last && last.group?.id === group?.id) last.tabs.push(tab);
    else segments.push({ group, tabs: [tab] });
  }
  return segments;
};
