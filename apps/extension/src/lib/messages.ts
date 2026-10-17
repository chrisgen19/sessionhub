import { z } from "zod";
import { WORKSPACE_LIMITS } from "@sessionhub/contracts/api-workspaces";
import { SESSION_LIMITS, tabGroupColorSchema } from "@sessionhub/contracts/session";
import type { CaptureReport } from "@sessionhub/core/capture";
import { IMPORT_MAX_BYTES, type ImportReport } from "@sessionhub/core/session-import";
import type { AccountStatus, PairingOutcome } from "./account-service";
import type { SyncSummary } from "./sync-runner";
import type { RestoreJobRecord } from "./db";

/**
 * Where a restore opens its tabs. Absent means `new-windows` (the behaviour before targets existed).
 * `this-window` names the window by Chrome's runtime id, valid for this command only and never stored;
 * `skipOpen` leaves out tabs whose exact URL is already open there.
 */
const restoreTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new-windows") }),
  z.object({ kind: z.literal("one-window") }),
  z.object({ kind: z.literal("this-window"), windowId: z.int(), skipOpen: z.boolean() }),
]);
export type RestoreTarget = z.infer<typeof restoreTargetSchema>;

/**
 * Commands from extension pages to the background worker. The worker is the single
 * writer for sessions so a closing popup can never interrupt a save or restore.
 */
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.capture"),
    // The UI sends only `tabs`: what the user ticked in the save picker. `window` and `all-windows`
    // remain for tests and fixtures. Tab ids are Chrome's runtime ids, valid for this save only.
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("window"), windowId: z.int() }),
      z.object({ kind: z.literal("all-windows") }),
      z.object({ kind: z.literal("tabs"), tabIds: z.array(z.int()).min(1).max(SESSION_LIMITS.windowsMax * SESSION_LIMITS.tabsPerWindowMax) }),
    ]),
    /** The name from the picker; the worker validates it like a rename. Absent: the default name. */
    name: z.string().max(SESSION_LIMITS.nameMax * 2).optional(),
  }),
  z.object({
    type: z.literal("session.rename"),
    sessionId: z.uuid(),
    expectedVersion: z.int().positive(),
    name: z.string().max(SESSION_LIMITS.nameMax * 2),
  }),
  z.object({ type: z.literal("session.delete"), sessionId: z.uuid() }),
  // Raw file text: the worker parses and re-validates it rather than trusting a page-prepared session.
  z.object({ type: z.literal("session.import"), content: z.string().max(IMPORT_MAX_BYTES) }),
  z.object({
    type: z.literal("restore.start"),
    sessionId: z.uuid(),
    tabIds: z.array(z.uuid()).max(SESSION_LIMITS.windowsMax * SESSION_LIMITS.tabsPerWindowMax).optional(),
    target: restoreTargetSchema.optional(),
  }),
  z.object({ type: z.literal("restore.retry"), jobId: z.uuid() }),
  z.object({
    type: z.literal("recovery.restore"),
    snapshotId: z.uuid(),
    tabIds: z.array(z.uuid()).max(SESSION_LIMITS.windowsMax * SESSION_LIMITS.tabsPerWindowMax).optional(),
    target: restoreTargetSchema.optional(),
  }),
  z.object({ type: z.literal("recovery.checkpointNow") }),
  // Account connection (pairing). None of these send saved sessions anywhere.
  z.object({ type: z.literal("account.status") }),
  z.object({ type: z.literal("account.connect") }),
  z.object({ type: z.literal("account.poll") }),
  z.object({ type: z.literal("account.cancel") }),
  z.object({ type: z.literal("account.check") }),
  z.object({ type: z.literal("account.disconnect") }),
  // Sync now: upload queued changes, then download the account's changes (only once sync is on).
  z.object({ type: z.literal("sync.now") }),
  // The user turned sync on (consent) and chose which of this browser's sessions move into the account.
  z.object({ type: z.literal("sync.enable"), sessionIds: z.array(z.uuid()).max(10_000) }),
  z.object({ type: z.literal("sync.disable") }),
  // The user's choice for a change the server didn't accept (conflict review).
  z.object({ type: z.literal("sync.resolve"), sessionId: z.uuid(), choice: z.enum(["keep-mine", "keep-server", "save-both", "local-only"]) }),
  // Account workspaces (names are re-validated by the worker).
  z.object({ type: z.literal("workspace.create"), name: z.string().max(WORKSPACE_LIMITS.nameMax * 2), color: tabGroupColorSchema.nullable() }),
  z.object({
    type: z.literal("workspace.update"),
    workspaceId: z.uuid(),
    name: z.string().max(WORKSPACE_LIMITS.nameMax * 2).optional(),
    color: tabGroupColorSchema.nullable().optional(),
  }),
  z.object({ type: z.literal("workspace.delete"), workspaceId: z.uuid() }),
  z.object({ type: z.literal("session.assign"), sessionId: z.uuid(), workspaceId: z.uuid().nullable() }),
]);
export type Command = z.infer<typeof commandSchema>;

export interface CommandResults {
  /**
   * `syncing`: saved into the account (sync is on), so it uploads in the background. `missing`:
   * ticked tabs that were closed (or became SessionHub pages) before the save, so they weren't saved.
   */
  "session.capture": { sessionId: string; report: CaptureReport; syncing: boolean; missing: number };
  "session.rename": { version: number };
  "session.delete": Record<string, never>;
  "session.import": { sessionId: string; report: ImportReport; syncing: boolean };
  "restore.start": { job: RestoreJobRecord };
  "restore.retry": { job: RestoreJobRecord };
  "recovery.restore": { job: RestoreJobRecord };
  "recovery.checkpointNow": {
    status: "created" | "unchanged" | "empty" | "clean";
    snapshotId: string | null;
    /** Older checkpoints removed because storage was full. */
    freedForSpace: number;
  };
  "account.status": AccountStatus;
  "account.connect": AccountStatus;
  "account.poll": { outcome: PairingOutcome; status: AccountStatus };
  "account.cancel": AccountStatus;
  "account.check": AccountStatus;
  "account.disconnect": AccountStatus;
  "sync.now": SyncSummary;
  "sync.enable": { enabledAt: string; moved: number };
  "sync.disable": Record<string, never>;
  /** The session to show next: a new id when this browser's version became a separate session. */
  "sync.resolve": { sessionId: string };
  "workspace.create": { workspaceId: string };
  "workspace.update": Record<string, never>;
  /** Sessions that were in it, now in no workspace. */
  "workspace.delete": { moved: number };
  "session.assign": Record<string, never>;
}

export type ErrorCode =
  | "invalid-command"
  | "not-found"
  | "conflict"
  | "invalid-input"
  | "browser-error"
  | "storage-error"
  /** IndexedDB quota exhausted; the message says what did and didn't happen. */
  | "storage-full"
  /** The SessionHub server refused or couldn't be reached; local data is unaffected. */
  | "account-error";

export type CommandResponse<T extends Command["type"] = Command["type"]> =
  | { ok: true; data: CommandResults[T] }
  | { ok: false; error: { code: ErrorCode; message: string } };
