import { Globe } from "lucide-react";
import { GROUP_COLORS } from "@/lib/group-colors";
import { hostMark } from "@/lib/host-mark";

/** The site's letter mark (lib/host-mark.ts); a generic icon for anything that isn't a web page. */
export function SiteMark({ url }: { url: string }) {
  const mark = hostMark(url);
  if (!mark) return <Globe aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />;
  return (
    <span
      aria-hidden="true"
      className="grid size-4 shrink-0 place-items-center rounded-[4px] text-[10px] leading-none font-bold text-white"
      style={{ backgroundColor: GROUP_COLORS[mark.color] }}
    >
      {mark.letter}
    </span>
  );
}
