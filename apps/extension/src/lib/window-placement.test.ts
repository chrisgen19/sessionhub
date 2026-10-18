import { browser, type Browser } from "wxt/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlannedWindow } from "@sessionhub/core/restore-plan";
import { restoreBrowserWindow } from "./browser-restore";
import { handleCommand, type HandlerDeps } from "./command-handlers";
import type { RestoreTabOutcome } from "./db";
import { getOrCreateDevice, savedOnThisBrowser } from "./device-repository";
import { toSyncPayload } from "./sync-batch";
import { connectAs, freshDb, idFactory, sampleWindows } from "./test-fixtures";
import { createPlacement, savedPlacement } from "./window-placement";

const bounds = { left: 120, top: 90, width: 1100, height: 760 };

afterEach(() => vi.restoreAllMocks());

describe("savedPlacement", () => {
  it("keeps a normal window's state and bounds", () => {
    expect(savedPlacement({ state: "normal", ...bounds })).toEqual({ state: "normal", bounds });
  });

  it("saves a minimized window as normal, at the bounds Chrome reports for it", () => {
    expect(savedPlacement({ state: "minimized", ...bounds })).toEqual({ state: "normal", bounds });
  });

  it("saves maximized and full screen (kiosk too) by state; the capture then drops their bounds", () => {
    expect(savedPlacement({ state: "maximized", ...bounds }).state).toBe("maximized");
    expect(savedPlacement({ state: "locked-fullscreen" }).state).toBe("fullscreen");
  });

  it("leaves out what Chrome doesn't report", () => {
    expect(savedPlacement({})).toEqual({});
    expect(savedPlacement({ state: "normal", left: 0, top: 0 })).toEqual({ state: "normal" });
  });
});

describe("createPlacement", () => {
  it("opens maximized and full-screen windows by state alone (Chrome refuses bounds with them)", () => {
    expect(createPlacement({ state: "maximized", bounds })).toEqual({ state: "maximized" });
    expect(createPlacement({ state: "fullscreen" })).toEqual({ state: "fullscreen" });
  });

  it("gives a normal window its planned bounds, and nothing when none are planned", () => {
    expect(createPlacement({ state: "normal", bounds })).toEqual(bounds);
    expect(createPlacement({ state: "normal" })).toEqual({});
    expect(createPlacement({})).toEqual({});
  });
});

describe("restoreBrowserWindow placement", () => {
  const planned = (extra: Partial<PlannedWindow>): PlannedWindow => ({
    sourceWindowId: "w1",
    tabs: [{ sourceTabId: "t0", url: "https://a.test/", pinned: false, groupId: null }],
    groups: [],
    ...extra,
  });
  const record = vi.fn(async () => undefined);

  it("opens the window at its planned bounds, or maximized by state", async () => {
    const create = vi.spyOn(browser.windows, "create").mockImplementation(async () => ({ id: 1, tabs: [{ id: 10 }] }) as Browser.windows.Window);
    await restoreBrowserWindow(planned({ state: "normal", bounds }), record);
    await restoreBrowserWindow(planned({ state: "maximized" }), record);
    expect(create.mock.calls.map(([data]) => data)).toEqual([
      { url: "https://a.test/", focused: true, ...bounds },
      { url: "https://a.test/", focused: true, state: "maximized" },
    ]);
  });

  it("opens where Chrome puts new windows when Chrome refuses bounds mostly off its screens", async () => {
    const create = vi
      .spyOn(browser.windows, "create")
      .mockRejectedValueOnce(new Error("Invalid value for bounds. Bounds must be at least 50% within visible screen space."))
      .mockImplementation(async () => ({ id: 1, tabs: [{ id: 10 }] }) as Browser.windows.Window);
    const outcomes = await restoreBrowserWindow(planned({ state: "normal", bounds: { ...bounds, left: 9000 } }), record);
    expect(create.mock.calls.map(([data]) => data)).toEqual([{ url: "https://a.test/", focused: true, ...bounds, left: 9000 }, { url: "https://a.test/", focused: true }]);
    expect(outcomes).toEqual([{ sourceTabId: "t0", status: "opened" }]);
  });

  it("doesn't retry other failures: the tab is reported as not opened", async () => {
    const create = vi.spyOn(browser.windows, "create").mockRejectedValue(new Error("Browser is shutting down"));
    const outcomes = await restoreBrowserWindow(planned({ state: "normal", bounds }), record);
    expect(create).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([{ sourceTabId: "t0", status: "failed", error: "Browser is shutting down" }]);
  });
});

describe("savedOnThisBrowser", () => {
  it("is this installation, or this browser's device in the connected account; never another device or an import", async () => {
    const db = freshDb();
    const device = await getOrCreateDevice(db, idFactory(3), new Date("2026-10-18T08:00:00.000Z"));
    expect(await savedOnThisBrowser(db, device.installationId)).toBe(true);
    expect(await savedOnThisBrowser(db, "6f1c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f")).toBe(false);
    await connectAs(db, "AliceAccount00000000000000000000");
    expect(await savedOnThisBrowser(db, "6f1c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f")).toBe(true);
    expect(await savedOnThisBrowser(db, "11111111-2222-4333-8444-555555555555")).toBe(false);
    expect(await savedOnThisBrowser(db, null)).toBe(false);
  });
});

describe("saving and reopening", () => {
  const placedWindows = () => {
    const [first, second] = sampleWindows();
    return [
      { ...first!, state: "normal" as const, bounds },
      { ...second!, state: "maximized" as const, bounds: { left: 0, top: 0, width: 1728, height: 1023 } },
    ];
  };
  const makeDeps = (): HandlerDeps => ({
    db: freshDb(),
    readWindows: vi.fn(async () => placedWindows()),
    restoreWindow: vi.fn<HandlerDeps["restoreWindow"]>(async (window) => window.tabs.map((tab): RestoreTabOutcome => ({ sourceTabId: tab.sourceTabId, status: "opened" }))),
    now: () => new Date("2026-10-18T08:00:00.000Z"),
    createId: idFactory(8),
  });
  const placementsOpened = (deps: HandlerDeps) =>
    vi.mocked(deps.restoreWindow).mock.calls.map(([window]) => ({ state: window.state, bounds: window.bounds }));

  it("a session saved here reopens in new windows at its saved bounds; maximized stays maximized", async () => {
    const deps = makeDeps();
    const saved = await handleCommand({ type: "session.capture", scope: { kind: "all-windows" } }, deps);
    if (!saved.ok) throw new Error(saved.error.message);
    const { sessionId } = saved.data as { sessionId: string };
    expect(await handleCommand({ type: "restore.start", sessionId }, deps)).toMatchObject({ ok: true });
    expect(placementsOpened(deps)).toEqual([{ state: "normal", bounds }, { state: "maximized", bounds: undefined }]);
  });

  it("a session from another computer reopens at Chrome's default bounds, keeping states", async () => {
    const deps = makeDeps();
    const saved = await handleCommand({ type: "session.capture", scope: { kind: "all-windows" } }, deps);
    if (!saved.ok) throw new Error(saved.error.message);
    const { sessionId } = saved.data as { sessionId: string };
    await deps.db.sessions.update(sessionId, { sourceDeviceId: "11111111-2222-4333-8444-555555555555" });
    expect(await handleCommand({ type: "restore.start", sessionId }, deps)).toMatchObject({ ok: true });
    expect(placementsOpened(deps)).toEqual([{ state: "normal", bounds: undefined }, { state: "maximized", bounds: undefined }]);
  });

  it("one new window gets no saved placement", async () => {
    const deps = makeDeps();
    const saved = await handleCommand({ type: "session.capture", scope: { kind: "all-windows" } }, deps);
    if (!saved.ok) throw new Error(saved.error.message);
    const { sessionId } = saved.data as { sessionId: string };
    expect(await handleCommand({ type: "restore.start", sessionId, target: { kind: "one-window" } }, deps)).toMatchObject({ ok: true });
    expect(placementsOpened(deps)).toEqual([{ state: undefined, bounds: undefined }]);
  });

  it("uploads each window's state and bounds with the session", async () => {
    const deps = makeDeps();
    const saved = await handleCommand({ type: "session.capture", scope: { kind: "all-windows" } }, deps);
    if (!saved.ok) throw new Error(saved.error.message);
    const session = await deps.db.sessions.get((saved.data as { sessionId: string }).sessionId);
    const payload = toSyncPayload({ ...session!, workspaceId: undefined });
    expect(payload.windows.map(({ state, bounds: sent }) => ({ state, bounds: sent }))).toEqual([{ state: "normal", bounds }, { state: "maximized", bounds: undefined }]);
  });
});
