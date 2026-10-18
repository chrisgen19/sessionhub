import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Padding and a readable width for pages that aren't full-height (everything but Saved sessions). */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[1160px] px-4 py-6 sm:px-6 lg:px-9 lg:py-9">{children}</div>;
}

export function PageHeader({ title, description, aside }: { title: string; description: ReactNode; aside?: ReactNode }) {
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

const SETUP_STEPS = [
  { title: "Add the extension", body: "Install SessionHub in Chrome. It isn't on the Chrome Web Store yet; developers can load it unpacked." },
  { title: "Connect this account", body: "In the extension's manager, open Account and choose Connect account, then approve the request here." },
  { title: "Turn on sync", body: "Still in Account, turn on Sync. You see exactly which sessions upload before anything is sent." },
] as const;

/**
 * Shown while no browser is connected, so an empty account isn't mistaken for lost sessions. The
 * steps are numbered because they happen in that order.
 */
export function SyncNotice() {
  return (
    <section aria-label="Get started" className="mb-8 rounded-xl border border-line bg-surface p-5">
      <p className="text-[13px] leading-relaxed text-fg-muted">
        <span className="font-semibold text-fg">No browser is connected yet.</span> Sessions you save stay in the extension on that computer
        until you connect it and turn on sync. You can turn sync off at any time.
      </p>
      <ol className="mt-4 grid gap-4 sm:grid-cols-3">
        {SETUP_STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">{step.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
