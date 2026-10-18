import { describe, expect, it } from "vitest";
import { buildSavedSession } from "./capture";
import { planRestore, planRetry } from "./restore-plan";
import { buildCanonicalStructure } from "./session-structure";
import { createSessionExport } from "./session-export";
import { copyAsNewSession, parseSessionExport, prepareImportedSession } from "./session-import";
import { options, sequentialIds, tab } from "./test-helpers";
import { normalizePlacement } from "./window-placement";

const bounds = { left: -1280, top: 40, width: 1200, height: 800 };

describe("normalizePlacement", () => {
  it("keeps a normal window's bounds, and only the state of maximized and full-screen windows", () => {
    expect(normalizePlacement({ state: "normal", bounds })).toEqual({ state: "normal", bounds });
    expect(normalizePlacement({ state: "maximized", bounds })).toEqual({ state: "maximized" });
    expect(normalizePlacement({ state: "fullscreen" })).toEqual({ state: "fullscreen" });
  });

  it("treats bounds without a state as a normal window, and leaves everything out when unknown", () => {
    expect(normalizePlacement({ bounds })).toEqual({ state: "normal", bounds });
    expect(normalizePlacement({})).toEqual({});
    expect(normalizePlacement({ state: null, bounds: null })).toEqual({});
  });

  it("drops bounds the contract wouldn't accept, keeping the state", () => {
    expect(normalizePlacement({ state: "normal", bounds: { ...bounds, width: 0 } })).toEqual({ state: "normal" });
    expect(normalizePlacement({ bounds: { ...bounds, left: 1.5 } })).toEqual({});
  });
});

const twoWindows = () =>
  buildSavedSession(
    [
      { tabs: [tab(0, "https://a.test"), tab(1, "https://b.test")], groups: [], state: "normal", bounds },
      { tabs: [tab(0, "https://c.test")], groups: [], state: "maximized", bounds: { left: 0, top: 0, width: 1728, height: 1023 } },
      { tabs: [tab(0, "https://d.test")], groups: [] },
    ],
    options(),
  ).session;

describe("capture", () => {
  it("saves each window's state, bounds only for a normal one, nothing when unknown", () => {
    const [normal, maximized, unknown] = twoWindows().windows;
    expect(normal).toMatchObject({ state: "normal", bounds });
    expect(maximized).toMatchObject({ state: "maximized" });
    expect(maximized).not.toHaveProperty("bounds");
    expect(unknown).not.toHaveProperty("state");
    expect(unknown).not.toHaveProperty("bounds");
  });
});

describe("planRestore", () => {
  it("plans saved bounds only when asked (the session was saved on this computer); states always", () => {
    const session = twoWindows();
    const here = planRestore(session, { bounds: true });
    expect(here.windows.map(({ state, bounds: planned }) => ({ state, bounds: planned }))).toEqual([
      { state: "normal", bounds },
      { state: "maximized", bounds: undefined },
      { state: undefined, bounds: undefined },
    ]);
    const elsewhere = planRestore(session);
    expect(elsewhere.windows.map(({ state, bounds: planned }) => ({ state, bounds: planned }))).toEqual([
      { state: "normal", bounds: undefined },
      { state: "maximized", bounds: undefined },
      { state: undefined, bounds: undefined },
    ]);
  });

  it("plans no placement for one new window or this window, even from a single saved window", () => {
    const session = twoWindows();
    const merged = planRestore(session, { layout: "single", bounds: true });
    expect(merged.windows).toHaveLength(1);
    expect(merged.windows[0]).not.toHaveProperty("state");
    expect(merged.windows[0]).not.toHaveProperty("bounds");
    const firstOnly = { tabIds: new Set(session.windows[0]!.tabs.map((t) => t.id)), layout: "single" as const, bounds: true };
    expect(planRestore(session, firstOnly).windows[0]).not.toHaveProperty("bounds");
  });

  it("keeps the placement when retrying the tabs that didn't open", () => {
    const plan = planRestore(twoWindows(), { bounds: true });
    const retry = planRetry(plan, new Set([plan.windows[0]!.tabs[0]!.sourceTabId]));
    expect(retry.windows[0]).toMatchObject({ state: "normal", bounds });
  });
});

describe("server structure, import and copy", () => {
  it("API writes keep state and bounds, normalized, and treat null as absent", () => {
    const { windows } = buildCanonicalStructure(
      [
        { groups: [], tabs: [{ title: "", url: "https://a.test", pinned: false, groupId: null }], state: "normal", bounds },
        { groups: [], tabs: [{ title: "", url: "https://b.test", pinned: false, groupId: null }], state: "fullscreen", bounds },
        { groups: [], tabs: [{ title: "", url: "https://c.test", pinned: false, groupId: null }], state: null, bounds: null },
      ],
      sequentialIds(),
    );
    expect(windows[0]).toMatchObject({ state: "normal", bounds });
    expect(windows[1]).toEqual(expect.objectContaining({ state: "fullscreen" }));
    expect(windows[1]).not.toHaveProperty("bounds");
    expect(windows[2]).not.toHaveProperty("state");
  });

  it("an import keeps them (marked imported, so its bounds never apply), and so does a copy", () => {
    const session = twoWindows();
    const context = { now: new Date("2026-10-18T08:00:00.000Z"), createId: sequentialIds() };
    const file = parseSessionExport(JSON.stringify(createSessionExport(session, context.now)));
    const imported = prepareImportedSession(file, context).session;
    expect(imported.sourceDeviceId).toBeNull();
    expect(imported.windows[0]).toMatchObject({ state: "normal", bounds });
    expect(imported.windows[1]).toMatchObject({ state: "maximized" });
    const copy = copyAsNewSession(session, context);
    expect(copy.sourceDeviceId).toBe(session.sourceDeviceId);
    expect(copy.windows[0]).toMatchObject({ state: "normal", bounds });
  });
});
