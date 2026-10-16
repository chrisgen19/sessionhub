import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  /** When false, Esc and the close button are disabled (e.g. while a restore runs). */
  dismissible?: boolean;
  children: ReactNode;
}

/** Native modal dialog: focus trapping, Esc handling and inert background come from the platform. */
export function Modal({ title, onClose, dismissible = true, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open && typeof dialog.showModal === "function") dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      className="m-auto w-[min(460px,calc(100vw-32px))] rounded-2xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/45"
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <h2 id={titleId} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close"
          disabled={!dismissible}
          onClick={onClose}
          className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-muted disabled:opacity-40"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="px-5 pt-3 pb-5">{children}</div>
    </dialog>
  );
}

export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex flex-wrap justify-end gap-2">{children}</div>;
}

export const buttonClass = {
  primary:
    "inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-brand px-3.5 text-[13px] font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60",
  secondary:
    "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-[13px] font-semibold hover:bg-surface-muted disabled:opacity-60",
  danger:
    "inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-danger px-3.5 text-[13px] font-semibold text-surface hover:opacity-90 disabled:opacity-60",
  ghostDanger:
    "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-semibold text-danger hover:bg-danger-soft disabled:opacity-60",
} as const;
