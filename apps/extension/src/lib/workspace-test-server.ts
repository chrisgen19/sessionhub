import { vi } from "vitest";
import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import type { ApiWorkspace } from "@sessionhub/contracts/api-workspaces";
import type { SavedSession } from "@sessionhub/contracts/session";

/**
 * A small in-memory stand-in for the sync endpoints (docs/SYNC_PROTOCOL.md 13f/13g), enough to run
 * workspace flows end to end in unit tests: versions and conflicts, absent fields keeping the
 * server's, WORKSPACE_NOT_EMPTY, INVALID_WORKSPACE, a change log for pull, and bootstrap with the
 * live workspaces first. Sessions are known by template (their windows) plus version and workspace.
 */

type Operation = { clientOperationId: string; entityType: string; entityId: string; action: "upsert" | "delete"; expectedVersion: number; payload: Record<string, unknown> | null };
type Change = { sequence: string; entityType: string; entityId: string; action: "upsert" | "delete"; version: number; payload: unknown };
type ServerSession = { template: SavedSession; version: number; workspaceId: string | null; name: string; deleted: boolean };

const AT = "2026-10-16T09:00:00.000Z";
export const syncCursor = (sequence: number) => `c1.${sequence}.AAAAAAAAAAAAAAAAAAAAAA`;
/** A test setup mistake (an id the server doesn't know) fails loudly. */
const must = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`The test server has no ${what}`);
  return value;
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const createTestServer = () => {
  const workspaces = new Map<string, ApiWorkspace & { deleted: boolean }>();
  const sessions = new Map<string, ServerSession>();
  const changes: Change[] = [];
  const pushes: Operation[][] = [];
  const options: {
    /** Refuses chosen operations with a rejected code, or VALIDATION_ERROR. */
    refuse: (operation: Operation) => string | null;
    /** Runs while a push is in flight (its operations are already `sending` in the browser). */
    duringPush: (() => Promise<void>) | null;
  } = { refuse: () => null, duringPush: null };

  const detail = (id: string): ApiSessionDetail => {
    const session = must(sessions.get(id), `session ${id}`);
    const { template } = session;
    return {
      id,
      name: session.name,
      description: null,
      workspaceId: session.workspaceId,
      sourceDeviceId: template.sourceDeviceId,
      sourceDeviceName: "Chrome on Windows",
      isPinned: false,
      isArchived: false,
      version: session.version,
      tabCount: 4,
      windowCount: 2,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      windows: template.windows,
    };
  };
  const publicWorkspace = ({ deleted: _deleted, ...workspace }: ApiWorkspace & { deleted: boolean }): ApiWorkspace => workspace;
  const log = (entityType: string, entityId: string, action: "upsert" | "delete", version: number) => {
    const payload = action === "delete" ? null : entityType === "workspace" ? publicWorkspace(must(workspaces.get(entityId), `workspace ${entityId}`)) : detail(entityId);
    changes.push({ sequence: String(changes.length + 1), entityType, entityId, action, version, payload });
  };

  /** Changes made by another browser. */
  const elsewhere = {
    addWorkspace: (id: string, fields: Partial<ApiWorkspace> = {}) => {
      workspaces.set(id, { id, name: "Workspace", description: null, icon: null, color: null, position: 0, version: 1, createdAt: AT, updatedAt: AT, ...fields, deleted: false });
      log("workspace", id, "upsert", 1);
    },
    editWorkspace: (id: string, fields: Partial<ApiWorkspace>) => {
      const workspace = must(workspaces.get(id), `workspace ${id}`);
      Object.assign(workspace, fields, { version: workspace.version + 1 });
      log("workspace", id, "upsert", workspace.version);
    },
    deleteWorkspace: (id: string) => {
      const workspace = must(workspaces.get(id), `workspace ${id}`);
      Object.assign(workspace, { deleted: true, version: workspace.version + 1 });
      log("workspace", id, "delete", workspace.version);
    },
    /** A session the account has, without a change-log entry (as if before the cursor). */
    seedSession: (template: SavedSession, version: number, workspaceId: string | null = null) => {
      sessions.set(template.id, { template, version, workspaceId, name: template.name, deleted: false });
    },
    assignSession: (id: string, workspaceId: string | null) => {
      const session = must(sessions.get(id), `session ${id}`);
      Object.assign(session, { workspaceId, version: session.version + 1 });
      log("savedSession", id, "upsert", session.version);
    },
  };

  const pushOne = (operation: Operation): object => {
    const base = { clientOperationId: operation.clientOperationId, entityId: operation.entityId, replayed: false };
    const accepted = (serverVersion: number) => ({ ...base, status: "accepted", serverVersion, serverSequence: String(changes.length) });
    const conflict = (serverVersion: number) => ({ ...base, status: "conflict", code: "VERSION_CONFLICT", expectedVersion: operation.expectedVersion, serverVersion, message: "Changed elsewhere." });
    const rejected = (code: string) => ({ ...base, status: "rejected", code, message: `Refused: ${code}` });
    const refusal = options.refuse(operation);
    if (refusal === "VALIDATION_ERROR") return { status: "validation_error", clientOperationId: operation.clientOperationId, message: "Refused: VALIDATION_ERROR", issues: [] };
    if (refusal) return rejected(refusal);
    const payload = operation.payload ?? {};
    if (operation.entityType === "workspace") {
      const current = workspaces.get(operation.entityId);
      if (operation.action === "delete") {
        if (!current) return rejected("NOT_FOUND");
        if (current.deleted) return { ...accepted(current.version), serverSequence: null };
        if (current.version !== operation.expectedVersion) return conflict(current.version);
        if ([...sessions.values()].some((session) => !session.deleted && session.workspaceId === operation.entityId)) return rejected("WORKSPACE_NOT_EMPTY");
        elsewhere.deleteWorkspace(operation.entityId);
        return accepted(current.version);
      }
      if (operation.expectedVersion === 0) {
        if (current) return rejected("ID_IN_USE");
        if ([...workspaces.values()].filter((workspace) => !workspace.deleted).length >= 100) return rejected("LIMIT_REACHED");
        elsewhere.addWorkspace(operation.entityId, payload);
        return accepted(1);
      }
      if (!current || current.deleted) return rejected("NOT_FOUND");
      if (current.version !== operation.expectedVersion) return conflict(current.version);
      elsewhere.editWorkspace(operation.entityId, payload);
      return accepted(current.version);
    }
    const current = sessions.get(operation.entityId);
    if (!current || current.deleted) return rejected("NOT_FOUND");
    if (current.version !== operation.expectedVersion) return conflict(current.version);
    if (operation.action === "delete") {
      Object.assign(current, { deleted: true, version: current.version + 1 });
      log("savedSession", operation.entityId, "delete", current.version);
      return accepted(current.version);
    }
    const workspaceId = payload.workspaceId as string | null | undefined;
    if (workspaceId && (workspaces.get(workspaceId)?.deleted ?? true)) return rejected("INVALID_WORKSPACE");
    Object.assign(current, { name: payload.name, version: current.version + 1 }, workspaceId === undefined ? {} : { workspaceId });
    log("savedSession", operation.entityId, "upsert", current.version);
    return accepted(current.version);
  };

  const fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/sync/push") {
      const body = JSON.parse(String(init?.body)) as { operations: Operation[] };
      pushes.push(body.operations);
      const during = options.duringPush;
      options.duringPush = null;
      await during?.();
      return json(200, { protocolVersion: 1, results: body.operations.map(pushOne) });
    }
    if (url.pathname === "/api/v1/sync/pull") {
      const after = Number(url.searchParams.get("cursor")?.split(".")[1] ?? 0);
      return json(200, { protocolVersion: 1, cursor: url.searchParams.get("cursor"), nextCursor: syncCursor(changes.length), hasMore: false, changes: changes.slice(after) });
    }
    if (url.pathname === "/api/v1/sync/bootstrap") {
      const live = [...workspaces.values()].filter((workspace) => !workspace.deleted);
      const items = [
        ...live.map((workspace) => ({ entityType: "workspace", entityId: workspace.id, action: "upsert", version: workspace.version, payload: publicWorkspace(workspace) })),
        ...[...sessions.entries()].map(([id, session]) =>
          session.deleted ? { entityType: "savedSession", entityId: id, action: "delete", version: session.version, payload: null } : { entityType: "savedSession", entityId: id, action: "upsert", version: session.version, payload: detail(id) },
        ),
      ];
      return json(200, { protocolVersion: 1, cursor: syncCursor(changes.length), nextAfter: null, hasMore: false, items });
    }
    throw new TypeError("fetch failed");
  });

  return { workspaces, sessions, changes, pushes, options, elsewhere, fetch };
};
