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

/** States plainly that cloud sync doesn't exist yet, so empty lists aren't mistaken for data loss. */
export function SyncNotice() {
  return (
    <div className="mb-7 flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-[13px]">
      <CloudOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
      <p className="leading-relaxed text-fg-muted">
        <span className="font-semibold text-fg">Cloud sync isn&apos;t available yet.</span> Sessions you save stay in the extension on
        that computer, so they don&apos;t appear here. When sync arrives, you&apos;ll turn it on in the extension, see exactly what
        gets uploaded, and can turn it off at any time.
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
