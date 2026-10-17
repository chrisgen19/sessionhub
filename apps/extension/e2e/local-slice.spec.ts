import type { Worker } from "@playwright/test";
import type { browser } from "wxt/browser";
import { expect, getServiceWorker, launchWithExtension, SITE, test } from "./fixtures";

// The extension's `chrome` global inside worker.evaluate().
declare const chrome: typeof browser;

const snapshotWindows = (worker: Worker) =>
  worker.evaluate(async () => {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    const groups = await chrome.tabGroups.query({});
    return {
      windows: windows.map((window) => ({
        id: window.id,
        urls: (window.tabs ?? []).map((tab) => tab.url ?? tab.pendingUrl ?? ""),
        pinned: (window.tabs ?? []).filter((tab) => tab.pinned).map((tab) => tab.url ?? tab.pendingUrl ?? ""),
      })),
      groupTitles: groups.map((group) => group.title),
    };
  });

test("capture -> IndexedDB -> list -> restore into a new window, leaving existing tabs alone", async ({
  context,
  worker,
  extensionId,
}) => {
  const pageA = await context.newPage();
  await pageA.goto(`${SITE}/alpha`);
  const pageB = await context.newPage();
  await pageB.goto(`${SITE}/beta`);
  await worker.evaluate(async (site) => {
    const [beta] = await chrome.tabs.query({ url: `${site}/beta` });
    const groupId = await chrome.tabs.group({ tabIds: [beta!.id!] });
    await chrome.tabGroups.update(groupId, { title: "Research", color: "green" });
    const [alpha] = await chrome.tabs.query({ url: `${site}/alpha` });
    await chrome.tabs.update(alpha!.id!, { pinned: true });
  }, SITE);

  // Save from the real popup UI: its window's web pages start ticked (about:blank doesn't).
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole("tab", { name: "Save" }).click();
  // Exact: the badge only, not other text that mentions this window.
  await expect(popup.getByText("This window", { exact: true })).toBeVisible();
  await popup.getByRole("button", { name: "Save 2 tabs" }).click();
  await expect(popup.getByText(/saved locally: 2 tabs in 1 window/i)).toBeVisible();
  // The Open tab's list updates from IndexedDB written by the background worker.
  await popup.getByRole("tab", { name: "Open" }).click();
  await expect(popup.getByRole("button", { name: /^Window,/ })).toBeVisible();
  await popup.close();

  const before = await snapshotWindows(worker);

  // Find and restore it from the manager.
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  await manager.getByRole("searchbox").fill("beta");
  await manager.getByRole("button", { name: /^Window,/ }).click();
  const inspector = manager.getByRole("article", { name: /session details/i });
  await expect(inspector.getByText("Page beta").first()).toBeVisible();
  await expect(inspector.getByText("Research")).toBeVisible();
  // Only what was ticked: no about:blank, and never SessionHub's own pages.
  await expect(inspector.getByText(/can't be reopened/i)).toHaveCount(0);

  // The ticked tree is the preview: everything that can reopen starts ticked, in new windows.
  await inspector.getByRole("button", { name: "Open 2 tabs in 1 new window" }).click();
  await expect(inspector.getByText(/opened 2 of 2 tabs in 1 new window/i)).toBeVisible();

  const isNew = (window: { id?: number }) => !before.windows.some((old) => old.id === window.id);
  // New tabs report an empty url until navigation commits, so poll.
  await expect
    .poll(async () => (await snapshotWindows(worker)).windows.find(isNew)?.urls)
    .toEqual([`${SITE}/alpha`, `${SITE}/beta`]);
  const after = await snapshotWindows(worker);
  expect(after.windows).toHaveLength(before.windows.length + 1);
  const created = after.windows.find(isNew);
  expect(created?.pinned).toEqual([`${SITE}/alpha`]);
  expect(after.groupTitles.filter((title) => title === "Research")).toHaveLength(2);
  // Original tabs are untouched.
  for (const window of before.windows) {
    expect(after.windows.find((candidate) => candidate.id === window.id)?.urls).toEqual(
      expect.arrayContaining(window.urls.filter((url) => url.startsWith(SITE))),
    );
  }
});

test("the save picker saves exactly the tabs ticked; a tab that becomes a browser page or closes leaves the selection", async ({ context, worker, extensionId }) => {
  const other = await worker.evaluate(async (site) => {
    const window = await chrome.windows.create({ url: [`${site}/three`, `${site}/four`, `${site}/five`], focused: false });
    await chrome.tabs.create({ windowId: window!.id, url: "chrome://version", active: false });
    return window!.id;
  }, SITE);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html#view=open-tabs`);
  // Tabs opened through chrome.windows.create bypass the test's route, so match them by address.
  const region = manager.getByRole("region").filter({ hasText: "sessionhub.test/three" });
  await expect(region.getByRole("checkbox", { name: /sessionhub\.test\/five/ })).toBeVisible();

  await manager.getByRole("button", { name: "Select none" }).click();
  await expect(manager.getByText("No tabs selected")).toBeVisible();
  // The window's header ticks its web pages; the browser page stays unticked.
  await region.getByRole("checkbox", { name: /^Window \d/ }).check();
  await expect(manager.getByText("3 tabs in 1 window selected")).toBeVisible();
  await expect(region.getByRole("checkbox", { name: /chrome:\/\/version/ })).not.toBeChecked();
  await region.getByRole("checkbox", { name: /sessionhub\.test\/four/ }).uncheck();

  // A ticked tab that turns into a browser page is unticked: browser pages stay opt-in.
  const fiveId = await worker.evaluate(async ({ site, windowId }) => {
    const [five] = await chrome.tabs.query({ windowId, url: `${site}/five` });
    await chrome.tabs.update(five!.id!, { url: "chrome://settings" });
    return five!.id!;
  }, { site: SITE, windowId: other });
  await expect(region.getByRole("checkbox", { name: /chrome:\/\/settings/ })).not.toBeChecked();
  await expect(manager.getByText("1 tab in 1 window selected")).toBeVisible();
  // Ticked again by hand, then closed elsewhere: it leaves the list and the selection at once.
  await region.getByRole("checkbox", { name: /chrome:\/\/settings/ }).check();
  await expect(manager.getByText(/2 tabs in 1 window selected/)).toBeVisible();
  await worker.evaluate((id) => chrome.tabs.remove(id), fiveId);
  await expect(region.getByRole("checkbox", { name: /chrome:\/\/settings/ })).toHaveCount(0);
  await expect(manager.getByText("1 tab in 1 window selected")).toBeVisible();

  await manager.getByRole("textbox", { name: "Session name" }).fill("Only page three");
  await manager.getByRole("button", { name: "Save 1 tab" }).click();
  await expect(manager.getByText("Saved locally: 1 tab in 1 window.")).toBeVisible();

  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  await manager.getByRole("button", { name: /Only page three/ }).click();
  const inspector = manager.getByRole("article", { name: /session details/i });
  await expect(inspector.getByRole("region", { name: "Window 1" }).getByRole("listitem")).toHaveText([/sessionhub\.test\/three/]);
  await expect(inspector.getByRole("region", { name: "Window 2" })).toHaveCount(0);
});

test("saved sessions survive a service-worker stop and a browser restart", async ({ context, extensionId, userDataDir }) => {
  const page = await context.newPage();
  await page.goto(`${SITE}/persist`);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const response = await manager.evaluate(() =>
    chrome.runtime.sendMessage({ type: "session.capture", scope: { kind: "all-windows" } }),
  );
  expect(response).toMatchObject({ ok: true });

  // Force-stop the MV3 worker via CDP and wait until Chrome reports it stopped; the next
  // command must restart it and still work from durable IndexedDB state.
  const cdp = await context.newCDPSession(manager);
  const statuses: string[] = [];
  cdp.on("ServiceWorker.workerVersionUpdated", (event) => statuses.push(...event.versions.map((version) => version.runningStatus)));
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await expect.poll(() => statuses.at(-1)).toBe("stopped");
  const second = await manager.evaluate(() => chrome.runtime.sendMessage({ type: "session.capture", scope: { kind: "all-windows" } }));
  expect(second).toMatchObject({ ok: true });
  expect(statuses.slice(statuses.lastIndexOf("stopped"))).toContain("running");
  await expect(manager.getByRole("button", { name: /all windows,/i })).toHaveCount(2);

  // Restart the browser with the same profile.
  await context.close();
  const reopened = await launchWithExtension(userDataDir);
  try {
    const restartedWorker = await getServiceWorker(reopened);
    const id = new URL(restartedWorker.url()).host;
    const again = await reopened.newPage();
    await again.goto(`chrome-extension://${id}/manager.html`);
    await expect(again.getByRole("button", { name: /all windows,/i })).toHaveCount(2);
  } finally {
    await reopened.close();
  }
});

test("rejects malformed commands", async ({ context, extensionId }) => {
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const result = await manager.evaluate(() => chrome.runtime.sendMessage({ type: "tabs.closeAll" }));
  expect(result).toMatchObject({ ok: false, error: { code: "invalid-command" } });
});

test("export -> import round trip creates a separate session that restores", async ({ context, worker, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`${SITE}/gamma`);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const saved = await manager.evaluate(() => chrome.runtime.sendMessage({ type: "session.capture", scope: { kind: "all-windows" } }));
  expect(saved).toMatchObject({ ok: true });

  await manager.getByRole("button", { name: /all windows,/i }).click();
  const downloadPromise = manager.waitForEvent("download");
  await manager.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^sessionhub-all-windows-.*\.json$/);
  const exportPath = await download.path();

  await manager.getByLabel("Import a SessionHub export file").setInputFiles(exportPath);
  const dialog = manager.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Import session" })).toBeVisible();
  await dialog.getByRole("button", { name: "Import session" }).click();

  const inspector = manager.getByRole("article", { name: /session details/i });
  await expect(inspector.getByText(/imported from this browser/i)).toBeVisible();
  await expect(manager.getByRole("button", { name: /all windows,/i })).toHaveCount(2);
  const ids = await manager.evaluate(async () => {
    const request = indexedDB.open("sessionhub");
    const db = await new Promise<IDBDatabase>((resolve) => (request.onsuccess = () => resolve(request.result)));
    const all = await new Promise<{ id: string }[]>((resolve) => {
      const get = db.transaction("sessions").objectStore("sessions").getAll();
      get.onsuccess = () => resolve(get.result);
    });
    return all.map((session) => session.id);
  });
  expect(new Set(ids).size).toBe(2);

  const before = await snapshotWindows(worker);
  await inspector.getByRole("button", { name: "Open 1 tab in 1 new window" }).click();
  await expect(inspector.getByText(/opened 1 of 1 tab/i)).toBeVisible();
  await expect
    .poll(async () => (await snapshotWindows(worker)).windows.find((window) => !before.windows.some((old) => old.id === window.id))?.urls)
    .toEqual([`${SITE}/gamma`]);
});

test("retry reopens only the failed tab, in a new window, and only once", async ({ context, worker, extensionId }) => {
  for (const name of ["one", "two", "three"]) await (await context.newPage()).goto(`${SITE}/${name}`);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const saved = await manager.evaluate(() => chrome.runtime.sendMessage({ type: "session.capture", scope: { kind: "all-windows" } }));
  const restored = await manager.evaluate(
    (sessionId) => chrome.runtime.sendMessage({ type: "restore.start", sessionId }),
    (saved as { data: { sessionId: string } }).data.sessionId,
  );
  const jobId = (restored as { data: { job: { id: string } } }).data.job.id;

  // Simulate "two" having failed (e.g. its window was closed mid-restore).
  await manager.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("sessionhub");
      request.onsuccess = () => resolve(request.result);
    });
    const store = db.transaction("restoreJobs", "readwrite").objectStore("restoreJobs");
    const job = await new Promise<{ status: string; plan: { windows: { tabs: { sourceTabId: string; url: string }[] }[] }; outcomes: { sourceTabId: string; status: string; error?: string }[] }>(
      (resolve) => {
        const get = store.get(id);
        get.onsuccess = () => resolve(get.result);
      },
    );
    const two = job.plan.windows.flatMap((w) => w.tabs).find((tab) => tab.url.endsWith("/two"))!;
    job.outcomes = job.outcomes.map((o) => (o.sourceTabId === two.sourceTabId ? { sourceTabId: o.sourceTabId, status: "failed", error: "closed" } : o));
    job.status = "partial";
    await new Promise((resolve) => (store.put(job).onsuccess = resolve));
  }, jobId);

  const countUrl = async (url: string) => (await snapshotWindows(worker)).windows.flatMap((w) => w.urls).filter((u) => u === url).length;
  await expect.poll(() => countUrl(`${SITE}/one`)).toBe(2); // original tab + first restore
  const before = await snapshotWindows(worker);

  const retried = await manager.evaluate((id) => chrome.runtime.sendMessage({ type: "restore.retry", jobId: id }), jobId);
  expect(retried).toMatchObject({ ok: true, data: { job: { status: "completed", attempts: 2 } } });
  await expect
    .poll(async () => (await snapshotWindows(worker)).windows.find((w) => !before.windows.some((old) => old.id === w.id))?.urls)
    .toEqual([`${SITE}/two`]);
  expect(await countUrl(`${SITE}/one`)).toBe(2);
  expect(await countUrl(`${SITE}/three`)).toBe(2);

  const again = await manager.evaluate((id) => chrome.runtime.sendMessage({ type: "restore.retry", jobId: id }), jobId);
  expect(again).toMatchObject({ ok: false, error: { code: "conflict" } });
});

test("a real mid-restore failure can be retried from the summary", async ({ context, worker, extensionId }) => {
  for (const name of ["red", "green", "blue"]) await (await context.newPage()).goto(`${SITE}/${name}`);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const saved = await manager.evaluate(() => chrome.runtime.sendMessage({ type: "session.capture", scope: { kind: "all-windows" } }));
  const sessionId = (saved as { data: { sessionId: string } }).data.sessionId;

  // Close every new window as soon as Chrome creates it: like a user closing the
  // restored window mid-restore, later tabs.create calls fail for real.
  await worker.evaluate(() => {
    const closer = (window: { id?: number }) => void chrome.windows.remove(window.id!);
    (globalThis as unknown as { closer: typeof closer }).closer = closer;
    chrome.windows.onCreated.addListener(closer);
  });
  await manager.goto(`chrome-extension://${extensionId}/manager.html#session=${sessionId}`);
  // The summary shows inline in the inspector, under the open bar.
  const inspector = manager.getByRole("article", { name: /session details/i });
  await inspector.getByRole("button", { name: /^Open 3 tabs in \d new windows?$/ }).click();
  await expect(inspector.getByText(/the window was closed before this tab could open/i).first()).toBeVisible();
  const retryButton = inspector.getByRole("button", { name: /^retry \d+ tabs?$/i });
  await expect(retryButton).toBeVisible();
  const failedCount = Number((await retryButton.textContent())?.match(/\d+/)?.[0]);

  await worker.evaluate(() =>
    chrome.windows.onCreated.removeListener((globalThis as unknown as { closer: (w: { id?: number }) => void }).closer),
  );
  const before = await snapshotWindows(worker);
  await retryButton.click();
  await expect(inspector.getByText(/opened 3 of 3 tabs after 2 attempts/i)).toBeVisible();
  await expect(inspector.getByRole("button", { name: /^retry/i })).toHaveCount(0);

  // Only the tabs that failed were reopened, in one new window. A tab that hasn't started loading
  // yet reports an empty URL, so wait for the window to settle instead of reading it once. Saved
  // URLs show as one label (which tabs failed depends on timing); anything else shows as itself.
  const savedUrls = new Set([`${SITE}/red`, `${SITE}/green`, `${SITE}/blue`]);
  await expect
    .poll(async () =>
      (await snapshotWindows(worker)).windows
        .filter((w) => !before.windows.some((old) => old.id === w.id))
        .map((w) => w.urls.map((url) => (savedUrls.has(url) ? "saved tab" : url))),
    )
    .toEqual([Array<string>(failedCount).fill("saved tab")]);
});

/** Reads a whole object store from the extension's IndexedDB (runs in the page; pass the name as the evaluate argument). */
const readStore = async (store: "recoverySnapshots" | "recoveryState") => {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open("sessionhub");
    request.onsuccess = () => resolve(request.result);
  });
  return new Promise<unknown[]>((resolve) => {
    const get = db.transaction(store).objectStore(store).getAll();
    get.onsuccess = () => resolve(get.result);
  });
};

test("browser changes trigger an automatic checkpoint via a real alarm, restorable from Recovery", async ({ context, worker, extensionId }) => {
  test.setTimeout(150_000);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html#view=recovery`);
  await expect(manager.getByText(/automatic checkpoints appear as you browse/i)).toBeVisible();

  const page = await context.newPage();
  await page.goto(`${SITE}/checkpoint-me`);
  // The change is recorded durably and a debounce alarm is armed.
  await expect
    .poll(async () => ((await manager.evaluate(readStore, "recoveryState" as const)) as { dirty: boolean }[])[0]?.dirty)
    .toBe(true);
  expect(await worker.evaluate(() => chrome.alarms.get("recovery-debounce").then((alarm) => Boolean(alarm)))).toBe(true);
  expect(await worker.evaluate(() => chrome.alarms.get("recovery-periodic").then((alarm) => alarm?.periodInMinutes))).toBe(30);

  // Chrome fires the 30s debounce alarm; the open Recovery view updates live.
  const today = manager.getByRole("region", { name: "Today" });
  await expect(today.getByRole("button")).toHaveCount(1, { timeout: 100_000 });
  const snapshots = (await manager.evaluate(readStore, "recoverySnapshots" as const)) as {
    reason: string;
    session: { windows: { tabs: { url: string }[] }[] };
  }[];
  expect(snapshots[0]!.reason).toBe("automatic");
  const urls = snapshots[0]!.session.windows.flatMap((w) => w.tabs.map((t) => t.url));
  expect(urls).toContain(`${SITE}/checkpoint-me`);
  // SessionHub's own manager page is never captured.
  expect(urls.some((url) => url.startsWith(`chrome-extension://${extensionId}`))).toBe(false);
  expect(((await manager.evaluate(readStore, "recoveryState" as const)) as { dirty: boolean }[])[0]?.dirty).toBe(false);

  // Restore it into a new window from the Recovery inspector.
  await page.close();
  const before = await snapshotWindows(worker);
  await today.getByRole("button").click();
  const inspector = manager.getByRole("article", { name: /checkpoint details/i });
  await inspector.getByRole("button", { name: "Open 1 tab in 1 new window" }).click();
  await expect(inspector.getByText(/opened 1 of 1 tab/i)).toBeVisible();
  await expect
    .poll(async () => (await snapshotWindows(worker)).windows.find((w) => !before.windows.some((old) => old.id === w.id))?.urls)
    .toEqual([`${SITE}/checkpoint-me`]);
});

test("Checkpoint now skips unchanged state", async ({ context, extensionId }) => {
  await (await context.newPage()).goto(`${SITE}/steady`);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html#view=recovery`);
  await manager.getByRole("button", { name: "Checkpoint now" }).click();
  await expect(manager.getByText("Checkpoint saved.")).toBeVisible();
  await manager.getByRole("button", { name: "Checkpoint now" }).click();
  await expect(manager.getByText(/nothing changed since the last checkpoint/i)).toBeVisible();
  await expect(manager.getByRole("region", { name: "Today" }).getByRole("button")).toHaveCount(1);
});

test("a new worker settles a cut-off restore and prunes old jobs; the summary reopens and retries", async ({ context, worker, extensionId }) => {
  for (const name of ["north", "south", "east"]) await (await context.newPage()).goto(`${SITE}/${name}`);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const saved = await manager.evaluate(() => chrome.runtime.sendMessage({ type: "session.capture", scope: { kind: "all-windows" } }));
  const sessionId = (saved as { data: { sessionId: string } }).data.sessionId;

  // Seed what a dead worker leaves behind: a "running" job that only reached its first tab,
  // plus a completed job from 60 days ago.
  const ids = await manager.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("sessionhub");
      request.onsuccess = () => resolve(request.result);
    });
    const session = await new Promise<{ windows: { tabs: { id: string; url: string }[] }[] }>((resolve) => {
      const get = db.transaction("sessions").objectStore("sessions").get(id);
      get.onsuccess = () => resolve(get.result);
    });
    const tabs = session.windows.flatMap((w) => w.tabs).filter((t) => t.url.startsWith("https://"));
    const plan = {
      sessionId: id,
      windows: [{ sourceWindowId: crypto.randomUUID(), groups: [], tabs: tabs.map((t) => ({ sourceTabId: t.id, url: t.url, pinned: false, groupId: null })) }],
      skipped: [],
      tabCount: tabs.length,
    };
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const minuteAgo = new Date(Date.now() - 60_000).toISOString();
    const cutOff = {
      id: crypto.randomUUID(),
      sessionId: id,
      createdAt: minuteAgo,
      updatedAt: minuteAgo,
      status: "running",
      plan,
      outcomes: [{ sourceTabId: tabs[0]!.id, status: "opened" }],
      attempts: 1,
    };
    const ancient = { ...cutOff, id: crypto.randomUUID(), createdAt: old, updatedAt: old, status: "completed" };
    const store = db.transaction("restoreJobs", "readwrite").objectStore("restoreJobs");
    store.put(cutOff);
    store.put(ancient);
    await new Promise((resolve) => (store.transaction.oncomplete = resolve));
    return { cutOff: cutOff.id, ancient: ancient.id };
  }, sessionId);

  // Kill the worker, then wake a fresh one with any message.
  const cdp = await context.newCDPSession(manager);
  const statuses: string[] = [];
  cdp.on("ServiceWorker.workerVersionUpdated", (event) => statuses.push(...event.versions.map((v) => v.runningStatus)));
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await expect.poll(() => statuses.at(-1)).toBe("stopped");
  await manager.evaluate(() => chrome.runtime.sendMessage({ type: "noop" }));

  const readJobs = () =>
    manager.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("sessionhub");
        request.onsuccess = () => resolve(request.result);
      });
      return new Promise<{ id: string; status: string; interruptedAt?: string }[]>((resolve) => {
        const get = db.transaction("restoreJobs").objectStore("restoreJobs").getAll();
        get.onsuccess = () => resolve(get.result);
      });
    });
  await expect.poll(async () => (await readJobs()).find((j) => j.id === ids.cutOff)?.status).toBe("partial");
  const jobs = await readJobs();
  expect(jobs.find((j) => j.id === ids.cutOff)?.interruptedAt).toBeTruthy();
  expect(jobs.some((j) => j.id === ids.ancient)).toBe(false);

  // The inspector shows the interrupted job; its summary reopens and retries the rest.
  await manager.goto(`chrome-extension://${extensionId}/manager.html#session=${sessionId}`);
  const inspector = manager.getByRole("article", { name: /session details/i });
  await expect(inspector.getByText(/opened 1 of 3, interrupted/i)).toBeVisible();
  await inspector.getByRole("button", { name: "View summary" }).click();
  const dialog = manager.getByRole("dialog");
  await expect(dialog.getByText(/this restore was cut off/i)).toBeVisible();
  const restoreWorker = context.serviceWorkers()[0] ?? worker;
  const before = await snapshotWindows(restoreWorker);
  await dialog.getByRole("button", { name: "Retry 2 tabs" }).click();
  await expect(dialog.getByText(/opened 3 of 3 tabs after 2 attempts/i)).toBeVisible();
  await expect
    .poll(async () => (await snapshotWindows(restoreWorker)).windows.find((w) => !before.windows.some((old) => old.id === w.id))?.urls)
    .toEqual([`${SITE}/south`, `${SITE}/east`]);
});

