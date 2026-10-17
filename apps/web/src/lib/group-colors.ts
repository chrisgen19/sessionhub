import type { TabGroupColor } from "@sessionhub/contracts/session";

/** Chrome's tab-group palette, also used for workspace colors (same values as the extension). */
export const GROUP_COLORS: Record<TabGroupColor, string> = {
  grey: "#8a948f", blue: "#3b78e7", red: "#d93b30", yellow: "#e8a500", green: "#1f8b4c",
  pink: "#d63c86", purple: "#8a4fd8", cyan: "#0f8a9d", orange: "#e5711c",
};
