import { LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { ReviewChoice } from "@sessionhub/sync/review";
import { DialogActions, Modal, buttonClass } from "../../components/modal";
import { sendCommand } from "../../lib/message-client";
import type { ReviewItem } from "../../lib/review-repository";
import { REVIEW_CHOICE_TEXT, REVIEW_EXPLANATION } from "../../lib/review-text";
import { ReviewCompare } from "./review-compare";

interface ReviewDialogProps {
  item: ReviewItem;
  onClose: () => void;
  /** After a choice: the session to show (a new id when this browser's version became its own session). */
  onResolved: (sessionId: string) => void;
}

const itemName = (item: ReviewItem) => item.local?.name ?? item.server?.name ?? "A deleted session";

/** Shows both versions and the choices for one refused change (docs/SYNC_PROTOCOL.md section 9). */
export function ReviewDialog({ item, onClose, onResolved }: ReviewDialogProps) {
  const [busy, setBusy] = useState<ReviewChoice | "sync" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (choice: ReviewChoice) => {
    setBusy(choice);
    setError(null);
    const response = await sendCommand({ type: "sync.resolve", sessionId: item.sessionId, choice });
    setBusy(null);
    if (response.ok) onResolved(response.data.sessionId);
    else setError(response.error.message);
  };

  const syncNow = async () => {
    setBusy("sync");
    setError(null);
    const response = await sendCommand({ type: "sync.now" });
    setBusy(null);
    if (!response.ok) setError(response.error.message);
  };

  return (
    <Modal title={`Review "${itemName(item)}"`} onClose={onClose} dismissible={busy === null}>
      <p className="text-[13px] leading-relaxed text-fg-muted">
        {REVIEW_EXPLANATION[item.kind]}
        {item.kind === "rejected" && item.message ? ` ${item.message}` : ""}
      </p>
      <ReviewCompare item={item} />
      {item.choices.length === 0 ? (
        <p className="mt-4 rounded-lg bg-surface-muted px-3 py-2.5 text-[13px]">
          The other version hasn&apos;t downloaded yet. Sync now, then choose. Nothing is lost in the meantime.
        </p>
      ) : (
        <ul aria-label="Choices" className="mt-4 space-y-2">
          {item.choices.map((choice) => {
            const text = REVIEW_CHOICE_TEXT[item.kind][choice];
            if (!text) return null;
            return (
              <li key={choice}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void choose(choice)}
                  className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left hover:bg-surface-muted disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold">{text.label}</span>
                    <span className="block text-xs text-fg-muted">{text.detail}</span>
                  </span>
                  {busy === choice && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          Nothing was changed: {error}
        </p>
      )}
      <DialogActions>
        {item.choices.length === 0 && (
          <button type="button" className={buttonClass.primary} disabled={busy !== null} onClick={() => void syncNow()}>
            {busy === "sync" ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-4" />} Sync now
          </button>
        )}
        <button type="button" autoFocus className={buttonClass.secondary} onClick={onClose} disabled={busy !== null}>
          Decide later
        </button>
      </DialogActions>
    </Modal>
  );
}
