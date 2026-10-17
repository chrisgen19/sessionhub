import type { TabGroupColor } from "@sessionhub/contracts/session";

/** Chrome's tab-group palette, also used for workspace colors. */
export const GROUP_COLORS: Record<TabGroupColor, string> = {
  grey: "#8a948f",
  blue: "#3b78e7",
  red: "#d93b30",
  yellow: "#e8a500",
  green: "#1f8b4c",
  pink: "#d63c86",
  purple: "#8a4fd8",
  cyan: "#0f8a9d",
  orange: "#e5711c",
};

/** A decorative color swatch; a missing color shows as an outlined dot. */
export function ColorDot({ color, className = "size-2.5" }: { color: TabGroupColor | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full ${color ? "" : "border border-fg-muted"} ${className}`}
      style={color ? { backgroundColor: GROUP_COLORS[color] } : undefined}
    />
  );
}
