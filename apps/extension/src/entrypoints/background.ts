import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { readBrowserWindows } from "../lib/browser-capture";
import { restoreBrowserWindow } from "../lib/browser-restore";
import { handleCommand } from "../lib/command-handlers";
import { getDb } from "../lib/db";

export default defineBackground(() => {
  // Listeners are registered synchronously at startup (MV3 requirement). No state is
  // kept in worker globals: every command reads and writes IndexedDB.
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only this extension's own pages may send commands; there are no content scripts.
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL("/"))) {
      return false;
    }
    void handleCommand(message, {
      db: getDb(),
      readWindows: readBrowserWindows,
      restoreWindow: restoreBrowserWindow,
      now: () => new Date(),
      createId: () => crypto.randomUUID(),
    }).then(sendResponse);
    return true;
  });
});
