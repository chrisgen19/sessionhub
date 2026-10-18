import type { WindowBounds, WindowState } from "@sessionhub/contracts/session";
import type { PlannedWindow } from "@sessionhub/core/restore-plan";
import type { Browser } from "wxt/browser";

/**
 * Chrome's view of a window as a saved state and bounds (docs/DATA_MODEL.md, SavedSessionWindow).
 * A minimized window saves as `normal`, at the bounds Chrome reports for it (its normal size, per the
 * 2026-10-18 spike); kiosk full screen saves as full screen. The capture keeps bounds only for normal
 * windows (`normalizePlacement`).
 */
export const savedPlacement = (window: Pick<Browser.windows.Window, "state" | "left" | "top" | "width" | "height">): { state?: WindowState; bounds?: WindowBounds } => {
  const state: WindowState | undefined =
    window.state === "maximized" ? "maximized"
    : window.state === "fullscreen" || window.state === "locked-fullscreen" ? "fullscreen"
    : window.state === "normal" || window.state === "minimized" ? "normal"
    : undefined;
  const { left, top, width, height } = window;
  const bounds = left !== undefined && top !== undefined && width !== undefined && height !== undefined ? { left, top, width, height } : undefined;
  return { ...(state && { state }), ...(bounds && { bounds }) };
};

/**
 * What `windows.create` gets for a planned window. Chrome refuses a maximized or full-screen state
 * combined with bounds, so those open by state alone; a normal window gets its bounds when planned.
 */
export const createPlacement = (window: Pick<PlannedWindow, "state" | "bounds">): Pick<Browser.windows.CreateData, "state" | "left" | "top" | "width" | "height"> => {
  if (window.state === "maximized" || window.state === "fullscreen") return { state: window.state };
  return window.bounds ? { ...window.bounds } : {};
};

/** Chrome's refusal of bounds less than half on a screen ("Bounds must be at least 50% within visible screen space"). */
export const isOffScreenError = (error: unknown) => error instanceof Error && /bounds/i.test(error.message);
