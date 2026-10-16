import { HardDrive } from "lucide-react";

export function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-[9px] bg-brand font-extrabold tracking-tighter text-on-brand ${
        size === "sm" ? "size-7 text-sm" : "size-8 text-base"
      }`}
    >
      S
    </span>
  );
}

/**
 * Sync state indicator (docs/UI_UX_DESIGN.md section 13). Cloud sync doesn't exist yet,
 * so the only truthful state is "Local only".
 */
export function SyncStatusChip() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-fg-muted"
      title="Sessions are saved in this browser only. Cloud sync isn't available yet."
    >
      <HardDrive aria-hidden="true" className="size-3.5" />
      Local only
    </span>
  );
}
