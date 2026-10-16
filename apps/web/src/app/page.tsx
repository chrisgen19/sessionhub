import { CheckCircle2, Clock3, HardDrive, Info, Layers, RotateCcw, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

const FEATURES = [
  {
    icon: Layers,
    title: "Save in one click",
    body: "Capture the current window or every window, including pinned tabs and tab groups. No account needed.",
  },
  {
    icon: RotateCcw,
    title: "Restore safely",
    body: "Preview first, then reopen in new windows. Your open tabs are never closed or replaced, and skipped tabs are listed.",
  },
  {
    icon: ShieldCheck,
    title: "Private by default",
    body: "Sessions stay in your browser. SessionHub never reads cookies, passwords or page content.",
  },
] as const;

const WORKS_TODAY = [
  "Chrome extension: save current or all windows to local storage",
  "Search saved sessions by name, tab title or URL",
  "Restore into new windows with a preview and a per-tab result summary",
  "Rename, delete with confirmation, and export or import sessions as JSON",
];

const COMING_NEXT = [
  "Automatic recovery snapshots and retrying tabs that failed to reopen",
  "Side panel for navigating open tabs",
  "Account sign-in and opt-in sync between computers",
];

function StatusList({ title, icon, items }: { title: string; icon: ReactNode; items: string[] }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      <ul className="mt-3 space-y-2 text-[13px] text-fg-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 sm:px-8">
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-[9px] bg-brand font-extrabold text-on-brand">
            S
          </span>
          <span className="text-[17px] font-bold tracking-tight">SessionHub</span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-fg-muted">
          <HardDrive aria-hidden="true" className="size-3.5" />
          Early preview
        </span>
      </header>

      <main className="flex-1 py-10 sm:py-16">
        <section aria-labelledby="hero-heading" className="max-w-2xl">
          <h1 id="hero-heading" className="text-3xl font-bold tracking-tight sm:text-[40px] sm:leading-tight">
            Keep your browser context safe, searchable, and ready to reopen.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-fg-muted">
            SessionHub saves your Chrome windows and tabs on your computer, lets you find them again, and restores them into new
            windows when you need them. Sync between computers is planned and will always be opt-in.
          </p>
          <p className="mt-6 inline-flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
            The extension isn&apos;t on the Chrome Web Store yet. Developers can load it unpacked from this repository.
          </p>
        </section>

        <section aria-label="Features" className="mt-12 grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article key={title} className="rounded-xl border border-line bg-surface p-5">
              <span className="grid size-9 place-items-center rounded-lg bg-brand-soft text-brand">
                <Icon aria-hidden="true" className="size-[18px]" />
              </span>
              <h2 className="mt-4 text-sm font-semibold">{title}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{body}</p>
            </article>
          ))}
        </section>

        <section aria-labelledby="status-heading" className="mt-12">
          <h2 id="status-heading" className="text-lg font-semibold tracking-tight">
            Project status
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <StatusList title="Works today" icon={<CheckCircle2 aria-hidden="true" className="size-4 text-brand" />} items={WORKS_TODAY} />
            <StatusList title="Coming next" icon={<Clock3 aria-hidden="true" className="size-4 text-warning" />} items={COMING_NEXT} />
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-6 text-xs text-fg-muted">
        SessionHub does not offer end-to-end encryption. Cloud features, when they arrive, will explain exactly what is uploaded
        before you turn them on.
      </footer>
    </div>
  );
}
