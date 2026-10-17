import { describe, expect, it } from "vitest";
import type { OutboxRecord } from "./db";
import { retryDelayMs, selectPushBatch, toPushOperation, toSyncPayload } from "./sync-batch";
import { idFactory, sampleSession } from "./test-fixtures";

const ids = idFactory(4);

const operation = (entityId: string, overrides: Partial<OutboxRecord> = {}): OutboxRecord =>
  ({
    seq: 1,
    id: ids(),
    scope: "account:Alice",
    entityType: "savedSession",
    entityId,
    action: "upsert",
    payload: sampleSession({ id: entityId }),
    expectedVersion: 1,
    status: "queued",
    createdAt: "2026-10-16T08:00:00.000Z",
    updatedAt: "2026-10-16T08:00:00.000Z",
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    ...overrides,
  }) as OutboxRecord;

describe("toSyncPayload", () => {
  it("sends windows, groups and tabs in order, keeps group links and drops what can't be stored", () => {
    const session = sampleSession();
    const [first, second] = session.windows;
    const reordered = {
      ...session,
      windows: [
        { ...second!, sortOrder: 1 },
        { ...first!, sortOrder: 0, tabs: [...first!.tabs].reverse().concat({ ...first!.tabs[0]!, id: ids(), url: "", sortOrder: 9 }) },
        { ...second!, id: ids(), sortOrder: 2, tabs: [{ ...second!.tabs[0]!, id: ids(), url: "" }] },
      ],
    };
    const payload = toSyncPayload(reordered);
    expect(payload.name).toBe(session.name);
    expect(payload.windows.map((window) => window.tabs.map((tab) => tab.url))).toEqual([
      ["https://github.com/acme/pull/42", "https://react.dev/learn", "chrome://settings"],
      ["https://example.com/"],
    ]);
    const docs = first!.groups[0]!;
    expect(payload.windows[0]!.groups).toEqual([{ id: docs.id, title: "Docs", color: "blue", collapsed: false }]);
    expect(payload.windows[0]!.tabs[1]).toEqual({ title: "React docs", url: "https://react.dev/learn", pinned: false, groupId: docs.id });
  });

  it("sends deletes without a payload", () => {
    const op = operation(ids(), { action: "delete", payload: null, expectedVersion: 4 });
    expect(toPushOperation(op)).toEqual({ clientOperationId: op.id, entityType: "savedSession", entityId: op.entityId, action: "delete", expectedVersion: 4, payload: null });
  });
});

describe("selectPushBatch", () => {
  it("takes the first operation of each session and holds sessions with an unresolved conflict", () => {
    const [a, b, c] = [ids(), ids(), ids()];
    const outbox = [
      operation(a, { status: "sending", expectedVersion: 3 }),
      operation(b, { status: "conflict" }),
      operation(a, { expectedVersion: 4 }),
      operation(b, { expectedVersion: 2 }),
      operation(c, { status: "rejected" }),
      operation(c),
    ];
    expect(selectPushBatch(outbox).operations).toEqual([outbox[0]]);
  });

  it("stops at the operation and byte limits, and sets aside operations too large to ever send", () => {
    const outbox = [operation(ids()), operation(ids()), operation(ids())];
    expect(selectPushBatch(outbox, { operations: 2, bytes: 1_000_000 }).operations).toEqual(outbox.slice(0, 2));
    const oneFits = JSON.stringify(toPushOperation(outbox[0]!)).length + 10;
    expect(selectPushBatch(outbox, { operations: 25, bytes: oneFits }).operations).toEqual(outbox.slice(0, 1));
    expect(selectPushBatch(outbox, { operations: 25, bytes: 100 })).toEqual({ operations: [], tooLarge: outbox });
  });
});

describe("retryDelayMs", () => {
  it("starts at 5 s, doubles, caps at 15 minutes and jitters between half and the full delay", () => {
    expect([1, 2, 3].map((failures) => retryDelayMs(failures, () => 1))).toEqual([5_000, 10_000, 20_000]);
    expect(retryDelayMs(1, () => 0)).toBe(2_500);
    expect(retryDelayMs(30, () => 1)).toBe(900_000);
  });
});
