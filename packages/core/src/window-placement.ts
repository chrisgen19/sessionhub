import { windowBoundsSchema, type SavedWindow, type WindowBounds, type WindowState } from "@sessionhub/contracts/session";

/** A window's saved state and bounds; both absent when unknown. */
export type WindowPlacement = Pick<SavedWindow, "state" | "bounds">;

/**
 * What a saved window keeps of how it was shown (docs/DATA_MODEL.md, SavedSessionWindow): its state,
 * and its bounds only when it is a normal window (maximized and full-screen windows reopen by state
 * alone). Bounds the contract wouldn't accept are dropped, and bounds without a state mean a normal
 * window. Used for captures, API writes and imports alike, so every path stores the same thing.
 */
export const normalizePlacement = ({ state, bounds }: { state?: WindowState | null; bounds?: WindowBounds | null }): WindowPlacement => {
  const valid = bounds ? windowBoundsSchema.safeParse(bounds) : null;
  const shown = state ?? (valid?.success ? "normal" : undefined);
  if (!shown) return {};
  return shown === "normal" && valid?.success ? { state: shown, bounds: valid.data } : { state: shown };
};
