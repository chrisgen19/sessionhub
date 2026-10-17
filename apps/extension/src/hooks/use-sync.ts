import { liveQuery } from "dexie";
import { useCallback, useEffect, useState } from "react";
import { getDb } from "../lib/db";
import { sendCommand } from "../lib/message-client";
import { readSyncOverview } from "../lib/sync-overview";
import { syncNowMessage, type SyncOverview } from "../lib/sync-status";

/** Live overall sync state (null while loading). Updates when the worker writes. */
export function useSyncOverview(): SyncOverview | null {
  const [overview, setOverview] = useState<SyncOverview | null>(null);
  useEffect(() => {
    const subscription = liveQuery(() => readSyncOverview(getDb())).subscribe({
      next: setOverview,
      error: () => setOverview(null),
    });
    return () => subscription.unsubscribe();
  }, []);
  return overview;
}

type SyncAction = "enable" | "disable" | "now";
export type SyncMessage = { tone: "ok" | "error"; text: string };

/** Sync commands for the Account view; the worker does the work, this tracks busy state and the result. */
export function useSyncActions() {
  const [busy, setBusy] = useState<SyncAction | null>(null);
  const [message, setMessage] = useState<SyncMessage | null>(null);

  const enable = useCallback(async (sessionIds: string[]): Promise<boolean> => {
    setBusy("enable");
    setMessage(null);
    const response = await sendCommand({ type: "sync.enable", sessionIds });
    setBusy(null);
    if (!response.ok) {
      setMessage({ tone: "error", text: `Sync wasn't turned on: ${response.error.message}` });
      return false;
    }
    const moved = response.data.moved;
    setMessage({ tone: "ok", text: moved > 0 ? `Sync is on. Uploading ${moved === 1 ? "1 session" : `${moved} sessions`} to your account.` : "Sync is on." });
    return true;
  }, []);

  const disable = useCallback(async () => {
    setBusy("disable");
    setMessage(null);
    const response = await sendCommand({ type: "sync.disable" });
    setBusy(null);
    setMessage(response.ok ? { tone: "ok", text: "Sync is off. Your sessions stay in this browser and in your account." } : { tone: "error", text: response.error.message });
  }, []);

  const now = useCallback(async () => {
    setBusy("now");
    setMessage(null);
    const response = await sendCommand({ type: "sync.now" });
    setBusy(null);
    setMessage(response.ok ? syncNowMessage(response.data) : { tone: "error", text: response.error.message });
  }, []);

  return { busy, message, enable, disable, now };
}
