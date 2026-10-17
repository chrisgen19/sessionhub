import { Layers } from "lucide-react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { TabFavicon } from "../../components/tab-favicon";
import { previewTabs } from "../../lib/session-preview";

const tileClass = "size-8 shrink-0 rounded-lg bg-surface-muted";

/**
 * The first few sites in a session as one 32px tile (up to 2 x 2 favicons), so sessions with
 * generic names ("Window, Oct 17") are easier to tell apart. Decorative: the row's text names it.
 */
export function SessionFavicons({ session }: { session: SavedSession }) {
  const tabs = previewTabs(session);
  if (tabs.length <= 1) {
    return (
      <span aria-hidden="true" className={`${tileClass} grid place-items-center text-brand`}>
        {tabs[0] ? <TabFavicon url={tabs[0].url} restorable /> : <Layers className="size-4" />}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`${tileClass} grid grid-cols-2 place-content-center place-items-center gap-0.5 p-[3px]`}>
      {tabs.map((tab) => (
        <TabFavicon key={tab.id} url={tab.url} restorable small />
      ))}
    </span>
  );
}
