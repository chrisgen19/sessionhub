export type CaptureScope = "window" | "all-windows" | "checkpoint";

export interface NamingOptions {
  locale?: string;
  timeZone?: string;
}

/** Default name, e.g. "Window, Oct 16, 9:42 AM", "All windows, ..." or "Checkpoint, ...". */
export const defaultSessionName = (scope: CaptureScope, date: Date, options: NamingOptions = {}): string => {
  const stamp = new Intl.DateTimeFormat(options.locale ?? "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: options.timeZone,
  }).format(date);
  const label = scope === "window" ? "Window" : scope === "all-windows" ? "All windows" : "Checkpoint";
  return `${label}, ${stamp}`;
};
