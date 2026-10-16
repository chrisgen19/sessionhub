import { buildSavedSession, type CaptureWindowInput } from "@sessionhub/core/capture";
import type { SavedSession } from "@sessionhub/contracts/session";
import { createDb, type SessionHubDb } from "./db";

let dbCounter = 0;

/** Fresh, isolated fake-indexeddb database per test. */
export const freshDb = (): SessionHubDb => createDb(`sessionhub-test-${++dbCounter}-${Date.now()}`);

export const idFactory = (prefix = 0): (() => string) => {
  let next = 0;
  return () => `00000000-0000-4000-8${prefix.toString(16).padStart(3, "0")}-${(next++).toString(16).padStart(12, "0")}`;
};

export const sampleWindows = (): CaptureWindowInput[] => [
  {
    tabs: [
      { url: "https://github.com/acme/pull/42", title: "Fix login PR", pinned: true, index: 0, groupKey: null },
      { url: "https://react.dev/learn", title: "React docs", pinned: false, index: 1, groupKey: 5 },
      { url: "chrome://settings", title: "Settings", pinned: false, index: 2, groupKey: null },
    ],
    groups: [{ key: 5, title: "Docs", color: "blue", collapsed: false }],
  },
  {
    tabs: [{ url: "https://example.com/", title: "Example", pinned: false, index: 0, groupKey: null }],
    groups: [],
  },
];

export const sampleSession = (overrides: Partial<SavedSession> = {}, prefix = 1): SavedSession => ({
  ...buildSavedSession(sampleWindows(), {
    name: "Client Alpha research",
    now: new Date("2026-10-16T08:00:00.000Z"),
    device: { id: "0d6f6a4e-2f0c-4a43-8f5b-2a7e9a0c1d11", name: "This browser" },
    createId: idFactory(prefix),
  }).session,
  ...overrides,
});
