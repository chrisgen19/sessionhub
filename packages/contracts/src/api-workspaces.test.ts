import { describe, expect, it } from "vitest";
import { renameDeviceRequestSchema } from "./api-devices";
import { apiErrorResponseSchema } from "./api-sessions";
import { createWorkspaceRequestSchema, updateWorkspaceRequestSchema } from "./api-workspaces";

describe("workspace contracts", () => {
  it("trims names and fills defaults", () => {
    expect(createWorkspaceRequestSchema.parse({ name: "  Alpha " })).toEqual({ name: "Alpha", description: null, icon: null, color: null, position: 0 });
  });

  it.each([
    [{ name: "   " }, "name"],
    [{ name: "A", icon: "<svg onload=x>" }, "icon"],
    [{ name: "A", icon: "https://evil.test/x.png" }, "icon"],
    [{ name: "A", color: "magenta" }, "color"],
    [{ name: "A", position: -1 }, "position"],
    [{ name: "A", userId: "someone" }, ""],
  ])("rejects %j", (input, path) => {
    const result = createWorkspaceRequestSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path.join(".")).toBe(path);
  });

  it("needs a version and at least one change to update", () => {
    expect(updateWorkspaceRequestSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(updateWorkspaceRequestSchema.safeParse({ name: "B" }).success).toBe(false);
    expect(updateWorkspaceRequestSchema.parse({ expectedVersion: 2, color: null })).toEqual({ expectedVersion: 2, color: null });
  });

  it("accepts workspace conflicts and not-empty details in the error envelope", () => {
    const serverState = { id: "4b0c1c52-7a4d-4a0e-9a59-6d5f1f1e2b3c", name: "A", description: null, icon: null, color: null, position: 0, version: 2, createdAt: "2026-10-16T00:00:00.000Z", updatedAt: "2026-10-16T00:00:00.000Z" };
    expect(apiErrorResponseSchema.safeParse({ error: { code: "VERSION_CONFLICT", message: "m", expectedVersion: 1, serverVersion: 2, serverState } }).success).toBe(true);
    expect(apiErrorResponseSchema.safeParse({ error: { code: "WORKSPACE_NOT_EMPTY", message: "m", sessionCount: 3 } }).success).toBe(true);
  });
});

describe("device contracts", () => {
  it("trims and bounds the display name", () => {
    expect(renameDeviceRequestSchema.parse({ displayName: " Work PC " })).toEqual({ displayName: "Work PC" });
    expect(renameDeviceRequestSchema.safeParse({ displayName: "" }).success).toBe(false);
    expect(renameDeviceRequestSchema.safeParse({ displayName: "x".repeat(121) }).success).toBe(false);
  });
});
