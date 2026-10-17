import type { SavedSession } from "@sessionhub/contracts/session";
import type { RestoreDestination } from "@sessionhub/core/restore-plan";
import { browser } from "wxt/browser";
import type { RestoreJobRecord } from "../../lib/db";
import { sendCommand } from "../../lib/message-client";
import type { RestoreTarget } from "../../lib/messages";

export type OpenOutcome = { ok: true; job: RestoreJobRecord } | { ok: false; message: string };

/** Where the command sends the tabs; for this window, the window this page belongs to (the popup's own window). */
const targetFor = async (destination: RestoreDestination, skipOpen: boolean): Promise<RestoreTarget> => {
  if (destination !== "this-window") return { kind: destination };
  const current = await browser.windows.getCurrent();
  if (current.id === undefined) throw new Error("Couldn't tell which window this is");
  return { kind: "this-window", windowId: current.id, skipOpen };
};

/**
 * Asks the worker to open a session's (or checkpoint's) tabs: all of them, or only `tabIds`. The
 * worker runs the restore, so it finishes even if this page (the popup) closes meanwhile.
 */
export const sendOpen = async (input: {
  session: SavedSession;
  kind: "session" | "snapshot";
  destination: RestoreDestination;
  skipOpen: boolean;
  /** Unload background tabs once they start loading (best effort). */
  lazy: boolean;
  tabIds?: string[];
}): Promise<OpenOutcome> => {
  try {
    const target = await targetFor(input.destination, input.skipOpen);
    const extra = { ...(input.tabIds ? { tabIds: input.tabIds } : {}), ...(input.lazy ? { lazy: true } : {}) };
    const response = await sendCommand(
      input.kind === "snapshot"
        ? { type: "recovery.restore", snapshotId: input.session.id, ...extra, target }
        : { type: "restore.start", sessionId: input.session.id, ...extra, target },
    );
    return response.ok ? { ok: true, job: response.data.job } : { ok: false, message: response.error.message };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Couldn't open these tabs" };
  }
};
