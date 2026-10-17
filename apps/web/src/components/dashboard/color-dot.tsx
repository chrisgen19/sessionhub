import type { TabGroupColor } from "@sessionhub/contracts/session";
import { GROUP_COLORS } from "@/lib/group-colors";

/** A decorative color swatch; no color shows as an outlined dot. */
export function ColorDot({ color }: { color: TabGroupColor | null }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2 shrink-0 rounded-full ${color ? "" : "border border-fg-muted"}`}
      style={color ? { backgroundColor: GROUP_COLORS[color] } : undefined}
    />
  );
}
