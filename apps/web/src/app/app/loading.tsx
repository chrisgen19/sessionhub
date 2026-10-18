import { PageBody } from "@/components/dashboard/page-parts";

/** Stable-layout skeleton while a dashboard page loads (no full-screen spinner). */
export default function Loading() {
  return (
    <PageBody>
      <div aria-busy="true" aria-label="Loading" className="animate-pulse">
        <div className="mb-2 h-7 w-56 rounded-lg bg-surface-muted" />
        <div className="mb-8 h-4 w-80 max-w-full rounded bg-surface-muted" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="h-72 rounded-xl bg-surface-muted" />
          <div className="h-40 rounded-xl bg-surface-muted" />
        </div>
      </div>
    </PageBody>
  );
}
