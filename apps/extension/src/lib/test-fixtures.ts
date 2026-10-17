import { buildSavedSession, type CaptureWindowInput } from "@sessionhub/core/capture";
import type { SavedSession } from "@sessionhub/contracts/session";
import { accountScope } from "./account-scope";
import { createDb, type ConnectionRecord, type SessionHubDb, type SessionSyncRecord } from "./db";
import type { OpenWindow } from "./tab-selection";

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

/** Stores a connection to `accountId` (or a pre-v4 connection without an id when null). */
export const connectAs = async (db: SessionHubDb, accountId: string | null, accessToken = "shd_at_test"): Promise<void> => {
  const connection: ConnectionRecord = {
    key: "connection",
    apiOrigin: "https://sessionhub.example",
    deviceId: "6f1c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f",
    deviceName: "Chrome on Windows",
    account: { ...(accountId ? { id: accountId } : {}), name: "Pat", email: "pat@example.test" },
    connectedAt: "2026-10-16T08:00:00.000Z",
    accessToken,
    refreshToken: "shd_rt_test",
    accessExpiresAt: "2026-10-16T08:15:00.000Z",
    refreshExpiresAt: "2026-11-15T08:00:00.000Z",
  };
  await db.account.put(connection);
};

/** Writes a session straight into an account's cache, as a pull would (no outbox operation). */
export const seedAccountSession = async (db: SessionHubDb, accountId: string, session: SavedSession, sync: SessionSyncRecord): Promise<void> => {
  await db.sessions.put({ ...session, scope: accountScope(accountId), sync });
};

export const sampleSession = (overrides: Partial<SavedSession> = {}, prefix = 1): SavedSession => ({
  ...buildSavedSession(sampleWindows(), {
    name: "Client Alpha research",
    now: new Date("2026-10-16T08:00:00.000Z"),
    device: { id: "0d6f6a4e-2f0c-4a43-8f5b-2a7e9a0c1d11", name: "This browser" },
    createId: idFactory(prefix),
  }).session,
  ...overrides,
});

/** The save picker's view of `sampleWindows`: window 1 (current) with a browser page, window 2 with one tab. */
export const sampleOpenWindows = (): OpenWindow[] => [
  {
    id: 1,
    tabs: [
      { id: 101, title: "Fix login PR", url: "https://github.com/acme/pull/42", pinned: true, groupId: null, eligibility: "restorable" },
      { id: 102, title: "React docs", url: "https://react.dev/learn", pinned: false, groupId: 5, eligibility: "restorable" },
      { id: 103, title: "Settings", url: "chrome://settings", pinned: false, groupId: null, eligibility: "browser-internal" },
    ],
    groups: [{ id: 5, title: "Docs", color: "blue" }],
  },
  { id: 2, tabs: [{ id: 201, title: "Example", url: "https://example.com/", pinned: false, groupId: null, eligibility: "restorable" }], groups: [] },
];
