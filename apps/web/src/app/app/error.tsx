"use client";

import { AlertTriangle } from "lucide-react";

/** Dashboard error boundary. Shows no internals; offers a retry. */
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-line bg-surface px-6 py-10 text-center">
      <AlertTriangle aria-hidden="true" className="mx-auto size-6 text-warning" />
      <h1 className="mt-3 text-sm font-semibold">This page couldn&apos;t load</h1>
      <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-fg-muted">
        Something went wrong on our side. Your sessions in the extension aren&apos;t affected.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 inline-flex h-9 items-center rounded-lg bg-brand px-3.5 text-[13px] font-semibold text-on-brand hover:bg-brand-hover"
      >
        Try again
      </button>
    </div>
  );
}
