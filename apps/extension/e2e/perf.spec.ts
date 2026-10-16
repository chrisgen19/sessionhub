import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect, type BrowserContext, type Page, type Worker } from "@playwright/test";
import type { browser } from "wxt/browser";
import { getServiceWorker, launchWithExtension } from "./fixtures";

declare const chrome: typeof browser;

/**
 * Large live-browser baseline (run with `pnpm test:perf`). Sizes are overridable:
 * PERF_WINDOWS (default 4) x PERF_TABS_PER_WINDOW (default 30) = 120 tabs, 10 per group.
 * Thresholds are deliberately generous regression guards; the measured numbers are the
 * baseline and are written to test-results/perf.json.
 */
const WINDOWS = Number(process.env.PERF_WINDOWS ?? 4);
const TABS_PER_WINDOW = Number(process.env.PERF_TABS_PER_WINDOW ?? 30);
const TOTAL = WINDOWS * TABS_PER_WINDOW;
const RUNS = 3;

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/** Times a command sent from an extension page, measured inside the page (round trip to the worker). */
const timedCommand = (page: Page, command: unknown) =>
  page.evaluate(async (message) => {
    const start = performance.now();
    const response = await chrome.runtime.sendMessage(message);
    return { ms: performance.now() - start, response: response as { ok: boolean; data?: Record<string, unknown>; error?: unknown } };
  }, command);

/**
 * A real local HTTP server instead of Playwright route interception: interception sends
 * every request through CDP and would dominate the restore timing being measured.
 */
const startSite = async (): Promise<{ server: Server; site: string }> => {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<title>Page ${request.url?.slice(1) ?? ""}</title><h1>${request.url ?? ""}</h1>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, site: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

/** Opens WINDOWS windows of TABS_PER_WINDOW tabs, groups each block of 10, waits for URLs, then discards to save memory. */
const openLiveTabs = (worker: Worker, site: string) =>
  worker.evaluate(
    async ({ site, windows, perWindow }) => {
      for (let w = 0; w < windows; w += 1) {
        const urls = Array.from({ length: perWindow }, (_, t) => `${site}/w${w}/t${t}`);
        const created = await chrome.windows.create({ url: urls, focused: false });
        const tabIds = (created?.tabs ?? []).map((tab) => tab.id!);
        for (let g = 0; g * 10 < tabIds.length; g += 1) {
          const block = tabIds.slice(g * 10, g * 10 + 10) as [number, ...number[]];
          const groupId = (await chrome.tabs.group({ tabIds: block, createProperties: { windowId: created!.id! } })) as number;
          await chrome.tabGroups.update(groupId, { title: `W${w} group ${g}`, color: "blue" });
        }
      }
      const deadline = Date.now() + 60_000;
      for (;;) {
        const tabs = await chrome.tabs.query({ url: `${site}/*` });
        if (tabs.length >= windows * perWindow && tabs.every((tab) => tab.status === "complete")) break;
        if (Date.now() > deadline) throw new Error("tabs didn't finish loading");
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const loaded = await chrome.tabs.query({ url: `${site}/*`, active: false });
      await Promise.all(loaded.map((tab) => chrome.tabs.discard(tab.id!).catch(() => undefined)));
      return (await chrome.tabs.query({ url: `${site}/*` })).length;
    },
    { site, windows: WINDOWS, perWindow: TABS_PER_WINDOW },
  );

test.describe("@perf large live browser", () => {
  test.describe.configure({ timeout: 300_000 });
  let dir: string;
  let context: BrowserContext;
  let server: Server;
  let site: string;

  test.beforeEach(async () => {
    ({ server, site } = await startSite());
    dir = await mkdtemp(path.join(tmpdir(), "sessionhub-perf-"));
    // Fewer renderer processes keeps 100+ tabs within a small machine's memory.
    context = await launchWithExtension(dir, ["--renderer-process-limit=4"]);
  });
  test.afterEach(async () => {
    await context.close();
    await rm(dir, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  });

  test(`capture, checkpoint and restore ${TOTAL} tabs in ${WINDOWS} windows`, async () => {
    const worker = await getServiceWorker(context);
    const id = new URL(worker.url()).host;
    const results: Record<string, number | string> = { windows: WINDOWS, tabs: TOTAL, chromium: context.browser()?.version() ?? "persistent" };

    const setupStart = Date.now();
    expect(await openLiveTabs(worker, site)).toBe(TOTAL);
    results.setupMs = Date.now() - setupStart;

    const manager = await context.newPage();
    await manager.goto(`chrome-extension://${id}/manager.html`);

    // Capture: all windows, median of RUNS.
    const captures = [];
    for (let run = 0; run < RUNS; run += 1) captures.push(await timedCommand(manager, { type: "session.capture", scope: { kind: "all-windows" } }));
    expect(captures.every((c) => c.response.ok)).toBe(true);
    expect((captures[0]!.response.data!.report as { tabCount: number }).tabCount).toBeGreaterThanOrEqual(TOTAL);
    results.captureMedianMs = Math.round(median(captures.map((c) => c.ms)));
    const sessionId = captures[0]!.response.data!.sessionId as string;

    // Checkpoint: first is a real write, the rest hit the unchanged-fingerprint path.
    const checkpoints = [];
    for (let run = 0; run < RUNS; run += 1) checkpoints.push(await timedCommand(manager, { type: "recovery.checkpointNow" }));
    expect(checkpoints.map((c) => c.response.data?.status)).toEqual(["created", "unchanged", "unchanged"]);
    results.checkpointCreatedMs = Math.round(checkpoints[0]!.ms);
    results.checkpointUnchangedMedianMs = Math.round(median(checkpoints.slice(1).map((c) => c.ms)));

    // Manager: time to render the inspector with the full window tree.
    const renderStart = Date.now();
    await manager.goto(`chrome-extension://${id}/manager.html#session=${sessionId}`);
    await expect(manager.getByRole("article", { name: /session details/i }).getByText(`Page w${WINDOWS - 1}/t${TABS_PER_WINDOW - 1}`)).toBeVisible();
    results.inspectorRenderMs = Date.now() - renderStart;

    // Popup: open to interactive search with the recent list.
    const popup = await context.newPage();
    const popupStart = Date.now();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await expect(popup.getByRole("button", { name: /all windows,/i }).first()).toBeVisible();
    await expect(popup.getByRole("searchbox")).toBeEditable();
    results.popupInteractiveMs = Date.now() - popupStart;
    await popup.close();

    // Restore everything into new windows.
    const before = (await worker.evaluate(() => chrome.windows.getAll())).length;
    const restore = await timedCommand(manager, { type: "restore.start", sessionId });
    const job = restore.response.data!.job as { status: string; plan: { tabCount: number; windows: unknown[] }; outcomes: { status: string }[] };
    expect(job.status).toBe("completed");
    expect(job.plan.tabCount).toBe(TOTAL);
    expect(job.outcomes.filter((o) => o.status === "opened")).toHaveLength(TOTAL);
    results.restoreMs = Math.round(restore.ms);
    results.restorePerTabMs = Number((restore.ms / TOTAL).toFixed(1));
    const after = await worker.evaluate(() => chrome.windows.getAll({ populate: true }));
    expect(after.length - before).toBe(WINDOWS);
    const groups = await worker.evaluate(() => chrome.tabGroups.query({}));
    expect(groups.filter((group) => group.title?.startsWith("W0 group"))).toHaveLength(2 * Math.ceil(TABS_PER_WINDOW / 10));

    results.storageUsageKb = Math.round(
      ((await manager.evaluate(() => navigator.storage.estimate())).usage ?? 0) / 1024,
    );

    await writeFile(path.resolve(import.meta.dirname, "../test-results/perf.json"), JSON.stringify(results, null, 2)).catch(() => undefined);
    test.info().annotations.push({ type: "perf", description: JSON.stringify(results) });

    // Regression guards from the 2026-10-16 baseline (docs/TEST_PLAN.md section 5): about
    // 10x for the stable metrics; restore only about 2x because it varies widely between runs.
    expect(results.captureMedianMs).toBeLessThan(1_000);
    expect(results.checkpointCreatedMs).toBeLessThan(1_000);
    expect(results.inspectorRenderMs).toBeLessThan(2_000);
    expect(results.popupInteractiveMs).toBeLessThan(3_000);
    expect(results.restoreMs).toBeLessThan(60_000);
  });
});
