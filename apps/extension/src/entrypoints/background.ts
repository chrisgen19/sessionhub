import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { readBrowserWindows } from "../lib/browser-capture";
import { restoreBrowserWindow } from "../lib/browser-restore";
import { handleCommand, type HandlerDeps } from "../lib/command-handlers";
import { getDb } from "../lib/db";
import { runCheckpoint } from "../lib/recovery-checkpoint";
import { runRestoreHousekeeping } from "../lib/restore-job-repository";
import {
  ensurePeriodicAlarm,
  onBrowserChange,
  RECOVERY_DEBOUNCE_ALARM,
  RECOVERY_PERIODIC_ALARM,
  rescheduleIfStillDirty,
} from "../lib/recovery-scheduler";

const deps = (): HandlerDeps => ({
  db: getDb(),
  readWindows: readBrowserWindows,
  restoreWindow: restoreBrowserWindow,
  now: () => new Date(),
  createId: () => crypto.randomUUID(),
});

const changed = () => void onBrowserChange(getDb(), new Date()).catch(() => undefined);

export default defineBackground(() => {
  // Captured synchronously at worker start: any restore job still "running" that was last
  // updated before this moment belongs to a previous, now-dead worker.
  const workerStartedAt = new Date();

  // Listeners are registered synchronously at startup (MV3 requirement). No state is
  // kept in worker globals: every command and checkpoint reads and writes IndexedDB.
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only this extension's own pages may send commands; there are no content scripts.
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL("/"))) {
      return false;
    }
    void handleCommand(message, deps()).then(sendResponse);
    return true;
  });

  // Recovery: any material browser change marks the durable dirty flag.
  for (const event of [
    browser.tabs.onCreated,
    browser.tabs.onRemoved,
    browser.tabs.onMoved,
    browser.tabs.onAttached,
    browser.tabs.onDetached,
    browser.tabs.onReplaced,
    browser.windows.onCreated,
    browser.windows.onRemoved,
    browser.tabGroups.onCreated,
    browser.tabGroups.onUpdated,
    browser.tabGroups.onRemoved,
    browser.tabGroups.onMoved,
  ] as { addListener: (callback: () => void) => void }[]) {
    event.addListener(changed);
  }
  browser.tabs.onUpdated.addListener((_tabId, change) => {
    // Title, favicon and loading-state updates are not material.
    if (change.url !== undefined || change.pinned !== undefined || change.groupId !== undefined) changed();
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== RECOVERY_DEBOUNCE_ALARM && alarm.name !== RECOVERY_PERIODIC_ALARM) return;
    void runCheckpoint(deps(), { force: false, reason: "automatic" }).then((result) =>
      // After an error, leave the retry to the periodic alarm instead of re-arming every 30s.
      result.status === "error" ? undefined : rescheduleIfStillDirty(getDb()),
    );
  });

  // Browser start/install: capture what Chrome restored, and make sure the safety net exists.
  browser.runtime.onStartup.addListener(changed);
  browser.runtime.onInstalled.addListener(changed);
  void ensurePeriodicAlarm().catch(() => undefined);
  void runRestoreHousekeeping(getDb(), workerStartedAt, new Date());
});
