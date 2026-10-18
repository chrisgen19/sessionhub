import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page, Worker } from "@playwright/test";
import type { browser } from "wxt/browser";
import { expect, getServiceWorker, launchWithExtension, SITE, test } from "./fixtures";

// The extension's `chrome` global inside evaluate().
declare const chrome: typeof browser;

type Placement = { state?: string; left?: number; top?: number; width?: number; height?: number };

/** The window holding a tab at `url`, as Chrome reports it. */
const windowWith = (worker: Worker, url: string) =>
  worker.evaluate(async (address) => {
    const windows = await chrome.windows.getAll({ populate: true });
    const found = windows.find((window) => window.tabs?.some((tab) => (tab.url || tab.pendingUrl) === address));
    return found ? { state: found.state, left: found.left, top: found.top, width: found.width, height: found.height, id: found.id } : null;
  }, url);

const send = (page: Page, command: unknown) => page.evaluate((message) => chrome.runtime.sendMessage(message), command) as Promise<{ ok: boolean; data?: Record<string, unknown> }>;

/** Rewrites a saved session in the extension's IndexedDB (runs in an extension page). */
const moveFirstWindowOffScreen = (page: Page, sessionId: string) =>
  page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("sessionhub");
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const store = db.transaction("sessions", "readwrite").objectStore("sessions");
      const get = store.get(id);
      get.onsuccess = () => {
        const session = get.result as { windows: { bounds?: { left: number; top: number } }[] };
        session.windows[0]!.bounds = { ...session.windows[0]!.bounds!, left: 9000, top: 9000 };
        const put = store.put(session);
        put.onsuccess = () => resolve();
        put.onerror = () => reject(put.error);
      };
    });
  }, sessionId);

test("windows reopen at their saved size and position, maximized stays maximized, and bounds off every screen still open", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "sessionhub-bounds-"));
  const context = await launchWithExtension(userDataDir, [], { realWindows: true });
  try {
    const worker = await getServiceWorker(context);
    const extensionId = new URL(worker.url()).host;
    const manager = await context.newPage();
    await manager.goto(`chrome-extension://${extensionId}/manager.html`);

    // A normal window at a known place and size, and a maximized one.
    const tabIds = await worker.evaluate(async (site) => {
      const normal = await chrome.windows.create({ url: `${site}/placed`, left: 40, top: 30, width: 600, height: 420, focused: true });
      const maximized = await chrome.windows.create({ url: `${site}/maximized`, state: "maximized", focused: true });
      await new Promise((resolve) => setTimeout(resolve, 500));
      return [normal!.tabs![0]!.id!, maximized!.tabs![0]!.id!];
    }, SITE);
    const savedNormal = await windowWith(worker, `${SITE}/placed`);
    expect(savedNormal).toMatchObject({ state: "normal", width: 600, height: 420 });
    expect((await windowWith(worker, `${SITE}/maximized`))?.state).toBe("maximized");

    const saved = await send(manager, { type: "session.capture", scope: { kind: "tabs", tabIds }, name: "Placed windows" });
    expect(saved.ok).toBe(true);
    const sessionId = saved.data!.sessionId as string;
    await worker.evaluate(async (ids) => {
      for (const id of ids) await chrome.windows.remove(id);
    }, [savedNormal!.id!, (await windowWith(worker, `${SITE}/maximized`))!.id!]);
    await expect.poll(() => windowWith(worker, `${SITE}/placed`)).toBeNull();

    // Reopened in new windows on the computer that saved it: same bounds, still maximized.
    expect(await send(manager, { type: "restore.start", sessionId })).toMatchObject({ ok: true });
    await expect.poll(() => windowWith(worker, `${SITE}/placed`)).toMatchObject({
      state: "normal",
      left: savedNormal!.left,
      top: savedNormal!.top,
      width: 600,
      height: 420,
    } satisfies Placement);
    await expect.poll(async () => (await windowWith(worker, `${SITE}/maximized`))?.state).toBe("maximized");

    // Saved bounds no screen can show (a monitor gone since): Chrome refuses them, so it opens at its default place.
    await worker.evaluate(async () => {
      const windows = await chrome.windows.getAll();
      const current = await chrome.windows.getCurrent();
      for (const window of windows) if (window.id !== current.id) await chrome.windows.remove(window.id!);
    });
    await moveFirstWindowOffScreen(manager, sessionId);
    const reopened = await send(manager, { type: "restore.start", sessionId });
    expect(reopened).toMatchObject({ ok: true, data: { job: { status: "completed" } } });
    await expect.poll(() => windowWith(worker, `${SITE}/placed`)).not.toBeNull();
    expect((await windowWith(worker, `${SITE}/placed`))!.left).toBeLessThan(800);
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
