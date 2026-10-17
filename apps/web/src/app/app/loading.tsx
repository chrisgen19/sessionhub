/** Stable-layout skeleton while a dashboard page loads (no full-screen spinner). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse">
      <div className="mb-2 h-7 w-56 rounded-lg bg-surface-muted" />
      <div className="mb-8 h-4 w-80 max-w-full rounded bg-surface-muted" />
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <div key={key} className="h-24 rounded-xl bg-surface-muted" />
        ))}
      </div>
      <div className="h-40 rounded-xl bg-surface-muted" />
    </div>
  );
}
