import { z } from "zod";
import { SESSION_LIMITS } from "@sessionhub/contracts/session";
import type { CaptureReport } from "@sessionhub/core/capture";
import { IMPORT_MAX_BYTES, type ImportReport } from "@sessionhub/core/session-import";
import type { AccountStatus, PairingOutcome } from "./account-service";
import type { SyncSummary } from "./sync-runner";
import type { RestoreJobRecord } from "./db";

/**
 * Commands from extension pages to the background worker. The worker is the single
 * writer for sessions so a closing popup can never interrupt a save or restore.
 */
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.capture"),
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("window"), windowId: z.int() }),
      z.object({ kind: z.literal("all-windows") }),
    ]),
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
  }),
  z.object({ type: z.literal("restore.retry"), jobId: z.uuid() }),
  z.object({
    type: z.literal("recovery.restore"),
    snapshotId: z.uuid(),
    tabIds: z.array(z.uuid()).max(SESSION_LIMITS.windowsMax * SESSION_LIMITS.tabsPerWindowMax).optional(),
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
]);
export type Command = z.infer<typeof commandSchema>;

export interface CommandResults {
  /** `syncing`: saved into the account (sync is on), so it uploads in the background. */
  "session.capture": { sessionId: string; report: CaptureReport; syncing: boolean };
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
