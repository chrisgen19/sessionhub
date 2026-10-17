import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { getDb } from "../lib/db";
import { listReviewItems, type ReviewItem } from "../lib/review-repository";

/** Live list of changes waiting for review (empty when there are none; null while loading). */
export function useReviewItems(): ReviewItem[] | null {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  useEffect(() => {
    const subscription = liveQuery(() => listReviewItems(getDb())).subscribe({ next: setItems, error: () => setItems([]) });
    return () => subscription.unsubscribe();
  }, []);
  return items;
}
