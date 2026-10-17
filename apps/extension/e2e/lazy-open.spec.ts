import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Worker } from "@playwright/test";
import type { browser } from "wxt/browser";
import { expect, test } from "./fixtures";
import { send, windowIds } from "./window-helpers";

// The extension's `chrome` global inside evaluate().
declare const chrome: typeof browser;

/**
 * A real HTTP server (Playwright's routing doesn't see tabs the extension creates before it attaches),
 * so the pages commit and load as they would on the web.
 */
let server: Server;
let origin: string;
test.beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/favicon.ico") return response.writeHead(404).end();
    response.writeHead(200, { "content-type": "text/html" }).end(`<title>Title ${request.url!.slice(1)}</title>`);
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const tabsOf = (worker: Worker, windowId: number) =>
  worker.evaluate(
    async (windowId) =>
      (await chrome.tabs.query({ windowId }))
        .sort((a, b) => a.index - b.index)
        .map((tab) => ({ id: tab.id!, url: tab.url ?? "", title: tab.title ?? "", discarded: tab.discarded, active: tab.active, status: tab.status })),
    windowId,
  );

test("keep tabs unloaded: background tabs unload with their URLs kept, load when selected, and save with their real URLs", async ({ worker, context, extensionId }) => {
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  const source = await worker.evaluate(async (urls) => (await chrome.windows.create({ url: urls }))!.id!, ["a", "b", "c"].map((page) => `${origin}/${page}`));
  await expect.poll(async () => (await tabsOf(worker, source)).every((tab) => tab.status === "complete" && tab.url.startsWith(origin))).toBe(true);
  const saved = await send(manager, { type: "session.capture", scope: { kind: "window", windowId: source } });
  const sessionId = (saved as { data: { sessionId: string } }).data.sessionId;
  const windowsBefore = await windowIds(worker);

  await manager.goto(`chrome-extension://${extensionId}/manager.html#session=${sessionId}`);
  const inspector = manager.getByRole("article", { name: /session details/i });
  await inspector.getByRole("checkbox", { name: "Keep tabs unloaded until clicked" }).check();
  await inspector.getByRole("button", { name: "Open 3 tabs in 1 new window" }).click();
  await expect(inspector.getByText("Opened 3 of 3 tabs in 1 new window.")).toBeVisible();

  const [restored] = (await windowIds(worker)).filter((id) => !windowsBefore.includes(id));
  // The first tab is the one selected in the new window: it stays loaded. The others unload, URLs kept.
  await expect
    .poll(async () => (await tabsOf(worker, restored!)).map(({ url, discarded, active }) => ({ url, discarded, active })))
    .toEqual([
      { url: `${origin}/a`, discarded: false, active: true },
      { url: `${origin}/b`, discarded: true, active: false },
      { url: `${origin}/c`, discarded: true, active: false },
    ]);

  // Selecting an unloaded tab loads it again.
  const [, second, third] = await tabsOf(worker, restored!);
  await worker.evaluate(
    async ({ windowId, tabId }) => {
      await chrome.windows.update(windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
    },
    { windowId: restored!, tabId: second!.id },
  );
  await expect
    .poll(async () => (await tabsOf(worker, restored!))[1])
    .toMatchObject({ url: `${origin}/b`, title: "Title b", discarded: false, status: "complete" });

  // A save of a tab that's still unloaded records its real URL, not a blank one.
  const resaved = await send(manager, { type: "session.capture", scope: { kind: "tabs", tabIds: [third!.id] } });
  const resavedId = (resaved as { data: { sessionId: string } }).data.sessionId;
  const urls = await manager.evaluate(
    (id) =>
      new Promise<string[]>((resolve) => {
        const request = indexedDB.open("sessionhub");
        request.onsuccess = () => {
          const get = request.result.transaction("sessions").objectStore("sessions").get(id);
          get.onsuccess = () => resolve((get.result as { windows: { tabs: { url: string }[] }[] }).windows.flatMap((w) => w.tabs.map((t) => t.url)));
        };
      }),
    resavedId,
  );
  expect(urls).toEqual([`${origin}/c`]);
});
