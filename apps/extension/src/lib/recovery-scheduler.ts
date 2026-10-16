import { browser } from "wxt/browser";
import type { SessionHubDb } from "./db";
import { getRecoveryState, markRecoveryDirty } from "./recovery-repository";

/** One-shot alarm that coalesces a burst of changes into one checkpoint. */
export const RECOVERY_DEBOUNCE_ALARM = "recovery-debounce";
/** Safety net in case a debounce alarm was lost (worker killed, browser restart). */
export const RECOVERY_PERIODIC_ALARM = "recovery-periodic";

/** Chrome 120+ fires alarms no sooner than 30s; older versions round up to 1 minute. */
export const DEBOUNCE_MINUTES = 0.5;
export const PERIODIC_MINUTES = 30;

export const scheduleDebouncedCheckpoint = async (): Promise<void> => {
  await browser.alarms.create(RECOVERY_DEBOUNCE_ALARM, { delayInMinutes: DEBOUNCE_MINUTES });
};

/**
 * Handles a browser change: persist the dirty flag first, then schedule a checkpoint
 * only on the clean-to-dirty transition, so continuous activity can't keep pushing
 * the checkpoint back (at most one checkpoint per debounce interval).
 */
export const onBrowserChange = async (db: SessionHubDb, now: Date): Promise<void> => {
  if (await markRecoveryDirty(db, now)) await scheduleDebouncedCheckpoint();
};

export const ensurePeriodicAlarm = async (): Promise<void> => {
  if (!(await browser.alarms.get(RECOVERY_PERIODIC_ALARM))) {
    await browser.alarms.create(RECOVERY_PERIODIC_ALARM, {
      delayInMinutes: PERIODIC_MINUTES,
      periodInMinutes: PERIODIC_MINUTES,
    });
  }
};

/** After a checkpoint, re-arm the debounce if changes arrived while it was capturing. */
export const rescheduleIfStillDirty = async (db: SessionHubDb): Promise<void> => {
  if ((await getRecoveryState(db)).dirty) await scheduleDebouncedCheckpoint();
};
