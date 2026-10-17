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
 * >=1280px: a narrow list rail | the inspector, which gets the rest of the width because it
 * holds the tab tree; each pane scrolls on its own. Narrower: the inspector replaces the list
 * as a detail view (the detail renders its own back link). docs/UI_UX_DESIGN.md section 7.
 */
export function MasterDetail({ label, list, detail, emptyDetail }: MasterDetailProps) {
  return (
    <div className="xl:grid xl:h-screen xl:grid-cols-[360px_minmax(0,1fr)] 2xl:grid-cols-[400px_minmax(0,1fr)]">
      <main aria-label={label} className={`min-w-0 border-line xl:overflow-y-auto xl:border-r xl:bg-surface ${detail ? "hidden xl:block" : ""}`}>
        {list}
      </main>
      <section aria-label="Inspector" className={`min-w-0 bg-surface xl:overflow-y-auto ${detail ? "" : "hidden xl:block"}`}>
        {detail ?? (
          <div className="grid h-full place-items-center p-8 text-center text-[13px] text-fg-muted">
            <div>
              <MousePointerClick aria-hidden="true" className="mx-auto mb-3 size-6" />
              {emptyDetail}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
