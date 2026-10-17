import { MousePointerClick } from "lucide-react";
import type { ReactNode } from "react";

interface MasterDetailProps {
  /** Accessible name of the list region. */
  label: string;
  list: ReactNode;
  detail: ReactNode | null;
  emptyDetail: string;
}

/**
 * >=1280px: list | inspector side by side. Narrower: the inspector replaces the list as
 * a detail view (the detail renders its own back link). docs/UI_UX_DESIGN.md section 7.
 */
export function MasterDetail({ label, list, detail, emptyDetail }: MasterDetailProps) {
  return (
    <div className="xl:grid xl:grid-cols-[minmax(420px,1fr)_400px]">
      <main aria-label={label} className={`min-w-0 ${detail ? "hidden xl:block" : ""}`}>
        {list}
      </main>
      <section
        aria-label="Inspector"
        className={`min-w-0 border-line bg-surface xl:sticky xl:top-0 xl:h-screen xl:overflow-y-auto xl:border-l ${detail ? "" : "hidden xl:block"}`}
      >
        {detail ?? (
          <div className="grid h-full place-items-center p-8 text-center text-xs text-fg-muted">
            <div>
              <MousePointerClick aria-hidden="true" className="mx-auto mb-2 size-5" />
              {emptyDetail}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
