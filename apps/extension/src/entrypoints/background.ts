import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { readBrowserWindows } from "../lib/browser-capture";
import { restoreBrowserWindow } from "../lib/browser-restore";
import { handleCommand, toSyncDeps, type HandlerDeps } from "../lib/command-handlers";
import { API_ORIGIN } from "../lib/api-config";
import { getDb } from "../lib/db";
import { runCheckpoint } from "../lib/recovery-checkpoint";
import { runRestoreHousekeeping } from "../lib/restore-job-repository";
import { syncNow } from "../lib/sync-runner";
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
  account: {
    fetch: (input, init) => fetch(input, init),
    apiOrigin: API_ORIGIN,
    openTab: async (url) => {
      await browser.tabs.create({ url, active: true });
    },
    platformOs: async () => (await browser.runtime.getPlatformInfo()).os,
  },
  sync: {
    random: Math.random,
    scheduleRetry: async (at) => {
      await browser.alarms.create(SYNC_RETRY_ALARM, { when: at.getTime() });
    },
  },
});

const SYNC_RETRY_ALARM = "sync-retry";
/** Remote changes arrive without a local trigger: check every 10 minutes (exits at once when sync is off). */
const SYNC_PERIODIC_ALARM = "sync-periodic";
const SYNC_PERIODIC_MINUTES = 10;
/** Commands after which the outbox may hold something new to upload. */
const SYNC_AFTER = new Set(["session.rename", "session.delete"]);

/** Syncs in the background (upload, then download); exits at once when disconnected or sync is off. */
const syncSoon = () => void syncNow(toSyncDeps(deps())).catch(() => undefined);

const ensureSyncAlarm = async () => {
  if (!(await browser.alarms.get(SYNC_PERIODIC_ALARM))) {
    await browser.alarms.create(SYNC_PERIODIC_ALARM, { delayInMinutes: SYNC_PERIODIC_MINUTES, periodInMinutes: SYNC_PERIODIC_MINUTES });
  }
};

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
    void handleCommand(message, deps()).then((response) => {
      sendResponse(response);
      const type = (message as { type?: unknown }).type;
      if (response.ok && typeof type === "string" && SYNC_AFTER.has(type)) syncSoon();
    });
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
    if (alarm.name === SYNC_RETRY_ALARM || alarm.name === SYNC_PERIODIC_ALARM) return syncSoon();
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
  // A previous worker may have been stopped mid-upload: its `sending` operations go out again.
  void ensureSyncAlarm().catch(() => undefined);
  syncSoon();
});
