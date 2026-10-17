"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface ConfirmDialogProps {
  title: string;
  confirmLabel: string;
  tone?: "danger" | "default";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}

/** Native modal: focus trap, Esc and inert page come from the platform. Cancel gets initial focus. */
export function ConfirmDialog({ title, confirmLabel, tone = "default", busy = false, onConfirm, onClose, children }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-2xl border border-line bg-surface p-5 text-fg shadow-2xl backdrop:bg-black/45"
    >
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-fg-muted">{children}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" autoFocus disabled={busy} onClick={onClose} className="h-9 rounded-lg border border-line px-3.5 text-[13px] font-semibold hover:bg-surface-muted disabled:opacity-60">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={`h-9 rounded-lg px-3.5 text-[13px] font-semibold disabled:opacity-60 ${tone === "danger" ? "bg-danger text-surface hover:opacity-90" : "bg-brand text-on-brand hover:bg-brand-hover"}`}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
