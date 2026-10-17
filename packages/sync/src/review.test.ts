import { describe, expect, it } from "vitest";
import { savedSessionSchema, type SavedSession } from "@sessionhub/contracts/session";
import { classifyReview, copyAsNewSession, keptCopyName, reviewChoices, serverVersionOf, type ReviewInput } from "./review";

const input = (overrides: Partial<Omit<ReviewInput, "operation">> & { operation?: Partial<ReviewInput["operation"]> } = {}): ReviewInput => ({
  hasLocalRecord: true,
  serverCopy: { action: "upsert", version: 5 },
  conflictServerVersion: 5,
  ...overrides,
  operation: { action: "upsert", status: "conflict", code: "VERSION_CONFLICT", ...overrides.operation },
});

describe("classifyReview", () => {
  it("tells the situations apart from the operation and the server copy", () => {
    expect(classifyReview(input())).toBe("edit-conflict");
    expect(classifyReview(input({ serverCopy: { action: "delete", version: 6 } }))).toBe("deleted-on-server");
    expect(classifyReview(input({ operation: { status: "rejected", code: "NOT_FOUND" } }))).toBe("deleted-on-server");
    expect(classifyReview(input({ operation: { action: "delete" }, hasLocalRecord: false }))).toBe("delete-conflict");
    expect(classifyReview(input({ operation: { status: "rejected", code: "ID_IN_USE" } }))).toBe("id-in-use");
    expect(classifyReview(input({ operation: { status: "rejected", code: "VALIDATION_ERROR" } }))).toBe("rejected");
    expect(classifyReview(input({ operation: { status: "rejected", code: "TOO_LARGE" } }))).toBe("rejected");
  });
});

describe("reviewChoices", () => {
  it("offers all three for an edit conflict once the server's version is here", () => {
    expect(reviewChoices("edit-conflict", input())).toEqual(["keep-mine", "keep-server", "save-both"]);
  });

  it("offers only what can be done before the server's copy arrives", () => {
    expect(reviewChoices("edit-conflict", input({ serverCopy: null }))).toEqual(["keep-mine"]);
    expect(reviewChoices("edit-conflict", input({ serverCopy: null, conflictServerVersion: null }))).toEqual([]);
    expect(serverVersionOf(input({ serverCopy: null, conflictServerVersion: 7 }))).toBe(7);
  });

  it("never offers to edit a session the server deleted, or to take a server state that isn't there", () => {
    expect(reviewChoices("deleted-on-server", input())).toEqual(["keep-mine", "keep-server"]);
    expect(reviewChoices("delete-conflict", input({ hasLocalRecord: false }))).toEqual(["keep-server", "keep-mine"]);
    expect(reviewChoices("id-in-use", input())).toEqual(["keep-mine", "local-only"]);
    expect(reviewChoices("rejected", input())).toEqual(["local-only"]);
  });

  it("doesn't offer to keep this browser's version once it was deleted here", () => {
    const gone = input({ hasLocalRecord: false });
    expect(reviewChoices("edit-conflict", gone)).toEqual(["keep-server"]);
    expect(reviewChoices("deleted-on-server", gone)).toEqual(["keep-server"]);
  });

  it("lets a refused upload of a session deleted here be dropped, so it can't stay in review forever", () => {
    const gone = input({ hasLocalRecord: false, serverCopy: null, conflictServerVersion: null });
    expect(reviewChoices("id-in-use", gone)).toEqual(["keep-server"]);
    expect(reviewChoices("rejected", gone)).toEqual(["keep-server"]);
  });
});

describe("copyAsNewSession", () => {
  const group = "4b0c1c52-7a4d-4a0e-9a59-6d5f1f1e2b3c";
  const original: SavedSession = {
    id: "64b7e32a-11f4-4caa-929f-0fab1139a7b0",
    schemaVersion: 1,
    name: "Research",
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-02T08:00:00.000Z",
    sourceDeviceId: "8c20b166-6156-4728-a9bc-10635ca68ca1",
    sourceDeviceName: "Chrome on Windows",
    version: 7,
    windows: [
      {
        id: "170c8810-86e0-4417-a57b-04a3d31742e3",
        sortOrder: 0,
        groups: [{ id: group, title: "Docs", color: "blue", collapsed: false, sortOrder: 0 }],
        tabs: [
          { id: "b7117d8d-9d95-4fae-b1b2-36d71d624b68", title: "A", url: "https://a.test/", pinned: false, sortOrder: 0, groupId: group, eligibility: "restorable" },
          { id: "c7117d8d-9d95-4fae-b1b2-36d71d624b68", title: "B", url: "https://b.test/", pinned: true, sortOrder: 1, groupId: null, eligibility: "restorable" },
        ],
      },
    ],
  };

  it("gives every part a new id, keeps the content and group links, and starts at version 1", () => {
    let next = 0;
    const createId = () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
    const copy = copyAsNewSession(original, { createId, now: new Date("2026-10-16T09:00:00.000Z"), name: keptCopyName("Research") });
    expect(savedSessionSchema.parse(copy)).toEqual(copy);
    const ids = [copy.id, copy.windows[0]!.id, ...copy.windows[0]!.groups.map((g) => g.id), ...copy.windows[0]!.tabs.map((t) => t.id)];
    expect(ids.some((id) => JSON.stringify(original).includes(id))).toBe(false);
    expect(copy).toMatchObject({ name: "Research (this browser's version)", version: 1, createdAt: "2026-10-16T09:00:00.000Z", sourceDeviceName: "Chrome on Windows" });
    expect(copy.windows[0]!.tabs[0]!.groupId).toBe(copy.windows[0]!.groups[0]!.id);
    expect(copy.windows[0]!.tabs.map(({ title, url, pinned }) => [title, url, pinned])).toEqual([["A", "https://a.test/", false], ["B", "https://b.test/", true]]);
  });

  it("fits a long name and its suffix into the limit", () => {
    expect(keptCopyName("x".repeat(300))).toHaveLength(200);
  });
});
