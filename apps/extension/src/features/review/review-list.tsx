import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useReviewItems } from "../../hooks/use-review";
import type { ReviewItem } from "../../lib/review-repository";
import { ReviewDialog } from "./review-dialog";

const SHORT: Record<ReviewItem["kind"], string> = {
  "edit-conflict": "Changed here and elsewhere",
  "deleted-on-server": "Deleted elsewhere",
  "delete-conflict": "Deleted here, changed elsewhere",
  "id-in-use": "ID already used in your account",
  rejected: "Can't be uploaded",
};

/** Every change waiting for review, in the Sync card (the only place a session deleted here can be reviewed). */
export function ReviewList() {
  const items = useReviewItems();
  const [open, setOpen] = useState<string | null>(null);
  if (!items || items.length === 0) return null;
  const current = items.find((item) => item.sessionId === open);
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-warning">
        <AlertTriangle aria-hidden="true" className="size-4" /> Needs review
      </h3>
      <ul aria-label="Changes to review" className="divide-y divide-line rounded-lg border border-line">
        {items.map((item) => (
          <li key={item.sessionId} className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{item.local?.name ?? item.server?.name ?? "A deleted session"}</span>
              <span className="block text-xs text-fg-muted">{SHORT[item.kind]}</span>
            </span>
            <button type="button" className="shrink-0 text-xs font-semibold text-brand hover:underline" onClick={() => setOpen(item.sessionId)}>
              Review…
            </button>
          </li>
        ))}
      </ul>
      {current && (
        <ReviewDialog
          item={current}
          onClose={() => setOpen(null)}
          onResolved={() => setOpen(null)}
        />
      )}
    </div>
  );
}
