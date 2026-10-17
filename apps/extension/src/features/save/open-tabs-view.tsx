import { SavePanel } from "./save-panel";

/** The manager's full save picker, like Session Buddy's "This Browser" (docs/UI_UX_DESIGN.md 18i). */
export function OpenTabsView() {
  return (
    <main aria-label="Open tabs" className="min-w-0">
      <header className="border-b border-line bg-surface px-4 py-5 lg:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Open tabs</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-fg-muted">
          Choose what to save. A window&apos;s checkbox selects its tabs; untick any tab you don&apos;t want. Browser pages can&apos;t reopen,
          so they start unticked. Nothing is saved until you press Save.
        </p>
      </header>
      <div className="max-w-3xl p-4 lg:p-6">
        <SavePanel variant="page" />
      </div>
    </main>
  );
}
