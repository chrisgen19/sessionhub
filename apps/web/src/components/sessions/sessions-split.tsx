import { MousePointerClick } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Saved sessions as in the extension manager (docs/UI_UX_DESIGN.md 18n). >=1280px: the list rail |
 * the open session, each scrolling on its own. Narrower: the open session replaces the list (it has
 * its own back link). Both panes are `relative`: absolutely positioned sr-only text deep in a pane
 * would otherwise escape it and stretch the page into blank space (the extension's PR #45).
 */
export function SessionsSplit({ rail, detail }: { rail: ReactNode; detail: ReactNode | null }) {
  return (
    <div className="xl:grid xl:h-full xl:grid-cols-[360px_minmax(0,1fr)] 2xl:grid-cols-[400px_minmax(0,1fr)]">
      <div className={`relative min-w-0 border-line bg-surface xl:overflow-y-auto xl:border-r ${detail ? "hidden xl:block" : ""}`}>{rail}</div>
      <div className={`relative min-w-0 bg-surface xl:overflow-y-auto ${detail ? "" : "hidden xl:block"}`}>
        {detail ?? (
          <div className="grid h-full place-items-center p-8 text-center text-[13px] text-fg-muted">
            <div>
              <MousePointerClick aria-hidden="true" className="mx-auto mb-3 size-6" />
              Select a session to see its windows and tabs.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
