import { describe, expect, it } from "vitest";
import { pushOperationSchema, pushResultSchema } from "./api-sync";

/** Distinct valid UUIDs (version 4, RFC 9562 variant) without a runtime crypto dependency. */
let counter = 0;
const id = () => `00000000-0000-4000-8000-${String((counter += 1)).padStart(12, "0")}`;
const windows = [{ tabs: [{ url: "https://a.test/", title: "A" }] }];
const base = (entityType: string, action: string, expectedVersion: number, payload: unknown) => ({ clientOperationId: id(), entityType, entityId: id(), action, expectedVersion, payload });

describe("pushOperationSchema", () => {
  it("accepts session uploads with or without a workspace, and workspace upserts and deletes", () => {
    for (const operation of [
      base("savedSession", "upsert", 0, { name: "S", windows }),
      base("savedSession", "upsert", 2, { name: "S", windows, workspaceId: id() }),
      base("savedSession", "upsert", 2, { name: "S", windows, workspaceId: null }),
      base("savedSession", "delete", 3, null),
      base("workspace", "upsert", 0, { name: "W" }),
      base("workspace", "upsert", 4, { name: "W", description: null, icon: "folder", color: "blue", position: 3 }),
      base("workspace", "delete", 5, null),
    ]) {
      expect(pushOperationSchema.safeParse(operation).success, JSON.stringify(operation)).toBe(true);
    }
  });

  it("refuses mixed-up, unknown or invalid operations", () => {
    for (const operation of [
      base("workspace", "upsert", 0, { name: "W", windows }),
      base("savedSession", "upsert", 0, { name: "S" }),
      base("savedSession", "upsert", 0, { name: "S", windows, workspaceId: "not-a-uuid" }),
      base("workspace", "upsert", 0, { name: "" }),
      base("workspace", "upsert", 0, { name: "W", icon: "<svg>" }),
      base("workspace", "delete", 0, null),
      base("tag", "upsert", 0, { name: "T" }),
    ]) {
      expect(pushOperationSchema.safeParse(operation).success, JSON.stringify(operation)).toBe(false);
    }
  });
});

describe("pushResultSchema", () => {
  it("knows the WORKSPACE_NOT_EMPTY rejection", () => {
    const result = { status: "rejected", clientOperationId: id(), entityId: id(), code: "WORKSPACE_NOT_EMPTY", message: "m", replayed: false };
    expect(pushResultSchema.safeParse(result).success).toBe(true);
  });
});
