import { describeEligibility, displayUrl } from "@sessionhub/core/url-classification";
import { Pin, X } from "lucide-react";
import type { ChangeEvent } from "react";
import { TabFavicon } from "../../components/tab-favicon";
import type { OpenTab } from "../../lib/tab-selection";

export const checkboxClass = "size-4 shrink-0 accent-[var(--sh-brand)]";

interface OpenTabRowProps {
  tab: OpenTab;
  checked: boolean;
  onToggle: (event: ChangeEvent<HTMLInputElement>) => void;
  /** A later copy of an address that is open earlier in the list. */
  duplicate?: boolean;
  /** With it, the title is a button that switches to the tab (the manager); without, plain text (the popup). */
  onGoTo?: () => void;
  /** With it, an ✕ closes the tab. */
  onClose?: () => void;
}

/**
 * An open tab: the box ticks it. Wide lists (container >= 672 px) put it on one line with the
 * address in a fixed-width last column, as the saved tab tree does.
 */
export function OpenTabRow({ tab, checked, onToggle, duplicate = false, onGoTo, onClose }: OpenTabRowProps) {
  const reason = describeEligibility(tab.eligibility);
  const title = tab.title || displayUrl(tab.url);
  return (
    <li className="group/row flex items-center rounded-md hover:bg-surface-muted">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-1.5 pr-1 pl-2 select-none @2xl:py-2" title={`${tab.title}\n${tab.url}`}>
        <input type="checkbox" checked={checked} onChange={onToggle} className={checkboxClass} />
        <TabFavicon url={tab.url} restorable={tab.eligibility === "restorable"} />
        <span className="min-w-0 flex-1 @2xl:contents">
          {/* A button inside the label doesn't tick the box: going to a tab and ticking it stay separate. */}
          <span className={`block min-w-0 truncate text-[13px] @2xl:flex-1 ${reason ? "text-fg-muted" : ""}`}>
            {onGoTo ? (
              <button type="button" onClick={onGoTo} className="max-w-full truncate text-left align-top hover:text-brand hover:underline">
                {title}
              </button>
            ) : (
              title
            )}
          </span>
          <span className="block truncate text-[11px] text-fg-muted @2xl:order-last @2xl:w-[30cqw] @2xl:shrink-0 @2xl:pl-4 @2xl:text-xs">{displayUrl(tab.url)}</span>
        </span>
        {tab.pinned && <Pin aria-label="Pinned" className="size-3.5 shrink-0 text-fg-muted" />}
        {duplicate && (
          <span title="This address is also open earlier in the list" className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-fg-muted">
            Duplicate
          </span>
        )}
        {reason && (
          <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning">
            Won't reopen<span className="sr-only">: {reason}</span>
          </span>
        )}
      </label>
      {/* Outside the label, so its name isn't part of the checkbox's. Shown on hover or focus; always on touch screens. */}
      {onClose && (
        <button
          type="button"
          aria-label={`Close tab: ${title}`}
          title="Close tab"
          onClick={onClose}
          className="mr-1 grid size-7 shrink-0 place-items-center rounded-md text-fg-muted opacity-0 group-hover/row:opacity-100 hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 pointer-coarse:opacity-100"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      )}
    </li>
  );
}
