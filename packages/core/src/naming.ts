export type CaptureScope = "window" | "all-windows";

export interface NamingOptions {
  locale?: string;
  timeZone?: string;
}

/** Default quick-save name, e.g. "Window, Oct 16, 9:42 AM" or "All windows, Oct 16, 9:42 AM". */
export const defaultSessionName = (scope: CaptureScope, date: Date, options: NamingOptions = {}): string => {
  const stamp = new Intl.DateTimeFormat(options.locale ?? "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: options.timeZone,
  }).format(date);
  return `${scope === "window" ? "Window" : "All windows"}, ${stamp}`;
};
