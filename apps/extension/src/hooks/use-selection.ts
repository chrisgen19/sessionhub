import { useCallback, useRef, useState } from "react";

/**
 * Ticked items of a list, for bulk actions. Shift-ticking ticks every item between the last one ticked
 * and this one, in the list's current order (docs/UI_UX_DESIGN.md, Bulk selection and actions).
 */
export function useSelection() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);

  const toggle = useCallback((id: string, range: boolean, order: readonly string[]) => {
    // Read before queuing: React may run the updater later, after the anchor has moved on.
    const from = range && anchor.current !== null ? order.indexOf(anchor.current) : -1;
    const to = order.indexOf(id);
    anchor.current = id;
    setSelected((current) => {
      const next = new Set(current);
      if (from >= 0 && to >= 0) {
        for (const item of order.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(item);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const set = useCallback((ids: Iterable<string>) => {
    setSelected(new Set(ids));
    anchor.current = null;
  }, []);

  return { selected, toggle, set };
}
