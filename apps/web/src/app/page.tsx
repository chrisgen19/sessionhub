import { Check, Info } from "lucide-react";
import Link from "next/link";
import { ProductPreview } from "@/components/public/product-preview";
import { PublicHeader } from "@/components/public/public-header";
import { INSTALL_URL, SOURCE_URL } from "@/lib/links";

/** A sequence, so the steps are numbered. */
const STEPS = [
  { title: "Save", body: "Tick the windows and tabs to keep and give them a name. They're saved in your browser; no account needed." },
  { title: "Find", body: "Search every saved session by its name, a tab's title or its address." },
  { title: "Reopen", body: "Open a whole session or only the tabs you tick, in new windows or the one you're in. Tabs you have open are never closed." },
] as const;

/** The last one is a limit, not a promise, and is marked differently. */
const PRIVACY = [
  "Saved sessions stay in your browser. Sync is off until you turn it on.",
  "Turning sync on shows exactly which sessions will upload before anything is sent.",
  "Automatic recovery checkpoints keep a copy of what's open, and never leave your computer.",
  "SessionHub never reads cookies, passwords or page content.",
] as const;

/**
 * The public landing page (docs/UI_UX_DESIGN.md 18o): the product as it looks, how it works and
 * where data lives. Getting the extension comes first; an account is optional, for sync.
 */
export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pt-6 sm:px-8">
      <PublicHeader signIn />

      <main className="flex-1">
        <section aria-labelledby="hero-heading" className="grid items-center gap-10 py-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14 lg:py-20">
          <div>
            <h1 id="hero-heading" className="text-[40px] leading-[1.05] font-bold tracking-tight sm:text-5xl">
              <span className="block">Save your windows.</span>
              <span className="block">Find them again.</span>
              <span className="block">Reopen them later.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-fg-muted">
              SessionHub keeps your Chrome windows and tabs on your computer, so a research rabbit hole, a client project or this
              afternoon&apos;s reading is one click from coming back. Turn on sync to see them on your other computers too.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a href={INSTALL_URL} className="inline-flex h-11 items-center rounded-lg bg-brand px-5 text-sm font-semibold text-on-brand hover:bg-brand-hover">
                Get the extension
              </a>
              <Link href="/signup" className="inline-flex h-11 items-center rounded-lg border border-line bg-surface px-5 text-sm font-semibold hover:bg-surface-muted">
                Create account
              </Link>
            </div>
            <p className="mt-3 max-w-md text-xs leading-relaxed text-fg-muted">
              Free and open source. It isn&apos;t on the Chrome Web Store yet, so for now it&apos;s built from the source. An account is
              optional: you only need one for sync.
            </p>
          </div>
          <ProductPreview />
        </section>

        <section aria-labelledby="how-heading" className="border-t border-line py-14">
          <h2 id="how-heading" className="text-2xl font-bold tracking-tight">
            How it works
          </h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span aria-hidden="true" className="text-3xl leading-none font-bold tabular-nums text-brand">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <h3 className="text-base font-semibold">{step.title}</h3>
                  <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-fg-muted">{step.body}</p>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="privacy-heading" className="grid gap-8 border-t border-line py-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
          <div>
            <h2 id="privacy-heading" className="text-2xl font-bold tracking-tight">
              Where your sessions live
            </h2>
            <p className="mt-3 max-w-md text-[13px] leading-relaxed text-fg-muted">
              Plain answers about what SessionHub keeps and what it sends. The privacy policy at the bottom of this page has the details.
            </p>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface text-[13px]">
            {PRIVACY.map((point) => (
              <li key={point} className="flex items-start gap-3 px-4 py-3">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
                {point}
              </li>
            ))}
            <li className="flex items-start gap-3 bg-warning-soft px-4 py-3">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>
                <span className="font-semibold">No end-to-end encryption.</span> Whoever runs the server can read the sessions you sync.
              </span>
            </li>
          </ul>
        </section>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line py-6 text-xs text-fg-muted">
        <p>SessionHub is an early preview.</p>
        <nav aria-label="Site" className="flex gap-4">
          <Link href="/privacy" className="hover:text-fg hover:underline">
            Privacy policy
          </Link>
          <a href={SOURCE_URL} className="hover:text-fg hover:underline">
            Source code
          </a>
        </nav>
      </footer>
    </div>
  );
}
