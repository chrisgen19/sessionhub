import { describe, expect, it } from "vitest";
import {
  API_LIMITS,
  createSessionRequestSchema,
  deleteSessionQuerySchema,
  listSessionsQuerySchema,
  updateSessionRequestSchema,
} from "./api-sessions";

const group = "4b0c1c52-7a4d-4a0e-9a59-6d5f1f1e2b3c";
const valid = {
  name: " Research ",
  windows: [{ groups: [{ id: group, title: "Docs", color: "blue" }], tabs: [{ url: "https://a.test/", groupId: group }, { url: "https://b.test/" }] }],
};

describe("createSessionRequestSchema", () => {
  it("applies defaults and trims", () => {
    const parsed = createSessionRequestSchema.parse(valid);
    expect(parsed).toMatchObject({ name: "Research", description: null, workspaceId: null, isPinned: false });
    expect(parsed.windows[0]!.tabs[1]).toEqual({ url: "https://b.test/", title: "", pinned: false, groupId: null });
  });

  it.each<[string, unknown]>([
    ["unknown fields", { ...valid, userId: "someone-else" }],
    ["an empty name", { ...valid, name: "  " }],
    ["no windows", { ...valid, windows: [] }],
    ["an empty window", { ...valid, windows: [{ tabs: [] }] }],
    ["a dangling group reference", { ...valid, windows: [{ tabs: [{ url: "https://a.test/", groupId: group }] }] }],
    ["duplicate group ids", { ...valid, windows: [{ groups: [{ id: group }, { id: group }], tabs: [{ url: "https://a.test/" }] }] }],
    ["a non-uuid id", { ...valid, id: "123" }],
    ["too many tabs", { ...valid, windows: Array.from({ length: 3 }, () => ({ tabs: Array.from({ length: 2000 }, () => ({ url: "https://a.test/" })) })) }],
  ])("rejects %s", (_label, body) => {
    expect(createSessionRequestSchema.safeParse(body).success).toBe(false);
  });

  it("allows exactly the session tab cap and rejects one more", () => {
    const sized = (counts: number[]) => ({ ...valid, windows: counts.map((count) => ({ tabs: Array.from({ length: count }, () => ({ url: "https://a.test/" })) })) });
    expect(2000 + 2000 + 1000).toBe(API_LIMITS.tabsPerSessionMax);
    expect(createSessionRequestSchema.safeParse(sized([2000, 2000, 1000])).success).toBe(true);
    expect(createSessionRequestSchema.safeParse(sized([2000, 2000, 1001])).success).toBe(false);
  });
});

describe("updateSessionRequestSchema", () => {
  it("requires an expected version and at least one change", () => {
    expect(updateSessionRequestSchema.safeParse({ name: "x" }).success).toBe(false);
    expect(updateSessionRequestSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(updateSessionRequestSchema.safeParse({ expectedVersion: 1, isArchived: true }).success).toBe(true);
  });
});

describe("query schemas", () => {
  it("coerces and bounds list and delete parameters", () => {
    expect(listSessionsQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(listSessionsQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(deleteSessionQuerySchema.parse({ expectedVersion: "3" })).toEqual({ expectedVersion: 3 });
    expect(deleteSessionQuerySchema.safeParse({}).success).toBe(false);
  });
});
