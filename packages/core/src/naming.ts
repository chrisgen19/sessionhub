export type CaptureScope = "window" | "all-windows" | "checkpoint";

export interface NamingOptions {
  locale?: string;
  timeZone?: string;
}

const stampOf = (date: Date, options: NamingOptions) =>
  new Intl.DateTimeFormat(options.locale ?? "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: options.timeZone,
  }).format(date);

/** Default name, e.g. "Window, Oct 16, 9:42 AM", "All windows, ..." or "Checkpoint, ...". */
export const defaultSessionName = (scope: CaptureScope, date: Date, options: NamingOptions = {}): string => {
  const label = scope === "window" ? "Window" : scope === "all-windows" ? "All windows" : "Checkpoint";
  return `${label}, ${stampOf(date, options)}`;
};

/** Default name for tabs chosen in the save picker: "Window, ..." from one window, "3 windows, ..." from several. */
export const selectionSessionName = (windowCount: number, date: Date, options: NamingOptions = {}): string =>
  `${windowCount === 1 ? "Window" : `${windowCount} windows`}, ${stampOf(date, options)}`;
