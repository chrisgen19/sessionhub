import { SessionsSplit } from "@/components/sessions/sessions-split";

/** The list rail's shape while Saved sessions loads, so the layout doesn't jump. */
export default function SessionsLoading() {
  return (
    <SessionsSplit
      detail={null}
      rail={
        <div aria-busy="true" aria-label="Loading" className="animate-pulse space-y-3 p-4">
          <div className="h-6 w-40 rounded-lg bg-surface-muted" />
          <div className="h-9 rounded-lg bg-surface-muted" />
          {[0, 1, 2, 3, 4].map((key) => (
            <div key={key} className="h-12 rounded-lg bg-surface-muted" />
          ))}
        </div>
      }
    />
  );
}
