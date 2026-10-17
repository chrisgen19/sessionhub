import { CloudOff, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({ title, description, aside }: { title: string; description: string; aside?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-[13px] text-fg-muted">{description}</p>
      </div>
      {aside}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center">
      <Icon aria-hidden="true" className="mx-auto size-6 text-fg-muted" />
      <h2 className="mt-3 text-sm font-semibold">{title}</h2>
      <div className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-fg-muted">{children}</div>
    </div>
  );
}

/** Shown while no browser is connected, so an empty account isn't mistaken for lost sessions. */
export function SyncNotice() {
  return (
    <div className="mb-7 flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-[13px]">
      <CloudOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
      <p className="leading-relaxed text-fg-muted">
        <span className="font-semibold text-fg">No browser is connected yet.</span> Sessions you save stay in the SessionHub extension
        on that computer until you connect it to this account and turn on sync there (Account, then Sync). You see exactly what
        uploads before anything is sent, and can turn sync off at any time.
      </p>
    </div>
  );
}

export function StatTile({ label, value, foot }: { label: string; value: number; foot: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-4">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-2 text-[26px] leading-none font-bold tabular-nums">{value.toLocaleString("en-US")}</p>
      <p className="mt-2 text-[11px] text-fg-muted">{foot}</p>
    </div>
  );
}
