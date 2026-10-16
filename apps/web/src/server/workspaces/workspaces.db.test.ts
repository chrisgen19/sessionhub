import { randomUUID } from "node:crypto";
import { createSessionRequestSchema } from "@sessionhub/contracts/api-sessions";
import { createWorkspaceRequestSchema, WORKSPACE_LIMITS, type CreateWorkspaceRequest } from "@sessionhub/contracts/api-workspaces";
import { getPrisma } from "@sessionhub/database/client";
import { afterAll, describe, expect, it } from "vitest";
import { createSession, deleteSession, updateSession } from "../sessions/mutations";
import { createWorkspace, deleteWorkspace, listWorkspaces, updateWorkspace } from "./service";

const prisma = getPrisma();
afterAll(async () => {
  await prisma.$disconnect();
});

const newUser = () => prisma.user.create({ data: { id: `user_${randomUUID()}`, name: "U", email: `${randomUUID()}@example.test` } });
const input = (overrides: Partial<CreateWorkspaceRequest> = {}) => createWorkspaceRequestSchema.parse({ name: "Client Alpha", ...overrides });
const sessionIn = (workspaceId: string | null) => createSessionRequestSchema.parse({ name: "S", workspaceId, windows: [{ tabs: [{ url: "https://a.test/" }] }] });
const clock = async (userId: string) => (await prisma.userSyncClock.findUnique({ where: { userId } }))?.lastSequence ?? 0n;
const changes = (userId: string) => prisma.syncChange.findMany({ where: { userId }, orderBy: { sequence: "asc" } });
const code = (promise: Promise<unknown>) => promise.then(() => "resolved", (error: { code?: string }) => error.code ?? "unknown");

describe("workspaces", () => {
  it("creates with one ordered change event and lists in display order with live session counts", async () => {
    const user = await newUser();
    const second = await createWorkspace(prisma, user.id, input({ name: "Second", position: 2, color: "blue", icon: "briefcase" }));
    const first = await createWorkspace(prisma, user.id, input({ name: "First", position: 1 }));
    expect(second).toMatchObject({ sequence: "1", workspace: { name: "Second", version: 1, color: "blue", icon: "briefcase" } });
    expect(await changes(user.id)).toMatchObject([
      { sequence: 1n, entityType: "workspace", entityId: second.workspace.id, changeKind: "upsert", entityVersion: 1 },
      { sequence: 2n, entityType: "workspace", entityId: first.workspace.id, changeKind: "upsert", entityVersion: 1 },
    ]);
    const live = await createSession(prisma, user.id, sessionIn(first.workspace.id));
    const gone = await createSession(prisma, user.id, sessionIn(first.workspace.id));
    await deleteSession(prisma, user.id, gone.detail.id, 1);
    expect(live.detail.workspaceId).toBe(first.workspace.id);
    const { items } = await listWorkspaces(prisma, user.id);
    expect(items.map((item) => [item.name, item.sessionCount])).toEqual([["First", 1], ["Second", 0]]);
  });

  it("makes an exact retry a no-op and rejects a different body or another user's id", async () => {
    const [alice, bob] = [await newUser(), await newUser()];
    const id = randomUUID();
    const first = await createWorkspace(prisma, alice.id, input({ id }));
    expect(await createWorkspace(prisma, alice.id, input({ id }))).toEqual({ workspace: first.workspace, sequence: null });
    expect(await code(createWorkspace(prisma, alice.id, input({ id, name: "Other" })))).toBe("ID_IN_USE");
    expect(await code(createWorkspace(prisma, bob.id, input({ id })))).toBe("ID_IN_USE");
    expect(await clock(alice.id)).toBe(1n);
    expect(await clock(bob.id)).toBe(0n);
  });

  it("updates with optimistic versions and returns the server state on conflict", async () => {
    const user = await newUser();
    const { workspace } = await createWorkspace(prisma, user.id, input());
    const renamed = await updateWorkspace(prisma, user.id, workspace.id, { expectedVersion: 1, name: "Renamed", color: null });
    expect(renamed).toMatchObject({ sequence: "2", workspace: { name: "Renamed", version: 2, color: null } });
    const stale = await updateWorkspace(prisma, user.id, workspace.id, { expectedVersion: 1, name: "Stale" }).catch((error: unknown) => error);
    expect(stale).toMatchObject({ code: "VERSION_CONFLICT", details: { expectedVersion: 1, serverVersion: 2, serverState: { name: "Renamed" } } });
    expect(await clock(user.id)).toBe(2n);
  });

  it("refuses to delete a workspace with live sessions, then tombstones it idempotently", async () => {
    const user = await newUser();
    const { workspace } = await createWorkspace(prisma, user.id, input());
    const session = await createSession(prisma, user.id, sessionIn(workspace.id));
    const blocked = await deleteWorkspace(prisma, user.id, workspace.id, 1).catch((error: unknown) => error);
    expect(blocked).toMatchObject({ code: "WORKSPACE_NOT_EMPTY", details: { sessionCount: 1 } });
    expect(await clock(user.id)).toBe(2n);

    await updateSession(prisma, user.id, session.detail.id, { expectedVersion: 1, workspaceId: null });
    const tombstone = await deleteWorkspace(prisma, user.id, workspace.id, 1);
    expect(tombstone).toMatchObject({ id: workspace.id, version: 2, sequence: "4" });
    expect(await deleteWorkspace(prisma, user.id, workspace.id, 1)).toEqual({ ...tombstone, sequence: null });
    expect((await changes(user.id)).at(-1)).toMatchObject({ entityType: "workspace", changeKind: "delete", entityVersion: 2, payload: null });
    expect((await listWorkspaces(prisma, user.id)).items).toEqual([]);

    // A tombstone can't be edited back, and sessions can't be put into it.
    expect(await code(updateWorkspace(prisma, user.id, workspace.id, { expectedVersion: 2, name: "Back" }))).toBe("NOT_FOUND");
    expect(await code(createSession(prisma, user.id, sessionIn(workspace.id)))).toBe("INVALID_WORKSPACE");
  });

  it("isolates accounts and caps the number of workspaces", async () => {
    const [alice, bob] = [await newUser(), await newUser()];
    const { workspace } = await createWorkspace(prisma, alice.id, input());
    expect(await code(updateWorkspace(prisma, bob.id, workspace.id, { expectedVersion: 1, name: "Pwned" }))).toBe("NOT_FOUND");
    expect(await code(deleteWorkspace(prisma, bob.id, workspace.id, 1))).toBe("NOT_FOUND");
    expect(await code(createSession(prisma, bob.id, sessionIn(workspace.id)))).toBe("INVALID_WORKSPACE");
    expect((await listWorkspaces(prisma, bob.id)).items).toEqual([]);

    await prisma.workspace.createMany({
      data: Array.from({ length: WORKSPACE_LIMITS.perUserMax - 1 }, (_, index) => ({ userId: alice.id, name: `W${index}` })),
    });
    expect(await code(createWorkspace(prisma, alice.id, input()))).toBe("LIMIT_REACHED");
    expect((await listWorkspaces(prisma, alice.id)).items).toHaveLength(WORKSPACE_LIMITS.perUserMax);
  });

  it("serializes concurrent edits: exactly one of two writes on the same version wins", async () => {
    const user = await newUser();
    const { workspace } = await createWorkspace(prisma, user.id, input());
    const results = await Promise.all([
      code(updateWorkspace(prisma, user.id, workspace.id, { expectedVersion: 1, name: "A" })),
      code(updateWorkspace(prisma, user.id, workspace.id, { expectedVersion: 1, name: "B" })),
    ]);
    expect(results.sort()).toEqual(["VERSION_CONFLICT", "resolved"]);
    expect((await changes(user.id)).map((change) => change.sequence)).toEqual([1n, 2n]);
  });
});
