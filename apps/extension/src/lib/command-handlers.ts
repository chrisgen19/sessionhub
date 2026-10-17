import { buildSavedSession, CaptureLimitError, type CaptureWindowInput } from "@sessionhub/core/capture";
import { defaultSessionName } from "@sessionhub/core/naming";
import { planRestore, planRetry, type RestorePlan } from "@sessionhub/core/restore-plan";
import { InvalidSessionNameError, renameSession } from "@sessionhub/core/session-edit";
import { parseSessionExport, prepareImportedSession, SessionImportError } from "@sessionhub/core/session-import";
import type { SavedSession } from "@sessionhub/contracts/session";
import { AccountApiError } from "./account-api";
import {
  cancelPairing,
  checkConnection,
  disconnect,
  getAccountStatus,
  pollPairing,
  startPairing,
  type AccountDeps,
} from "./account-service";
import type { RestoreTabOutcome, SessionHubDb } from "./db";
import { getOrCreateDevice } from "./device-repository";
import { runCheckpoint } from "./recovery-checkpoint";
import type { SyncDeps } from "./sync-gate";
import { syncNow } from "./sync-runner";
import { getSnapshot } from "./recovery-repository";
import { isQuotaError, RestoreRecordingError, STORAGE_FULL_HINT } from "./storage-errors";
import { commandSchema, type Command, type CommandResponse, type ErrorCode } from "./messages";
import {
  appendRestoreOutcomes,
  claimRestoreJobForRetry,
  createRestoreJob,
  finishRestoreJob,
  openedTabIds,
  RestoreJobNotFoundError,
  RestoreJobNotRetryableError,
} from "./restore-job-repository";
import {
  addSession,
  deleteSession,
  getSession,
  putSession,
  SessionExistsError,
  SessionNotFoundError,
  updateSession,
  VersionConflictError,
} from "./session-repository";

/** Browser side effects, injected so handlers can be tested without Chrome. */
export interface HandlerDeps {
  db: SessionHubDb;
  readWindows: (scope: Extract<Command, { type: "session.capture" }>["scope"]) => Promise<CaptureWindowInput[]>;
  /**
   * Opens one planned window and never touches existing windows. Passes each tab's outcome
   * to `record` as soon as it is known (before opening the next tab) and returns them all.
   */
  restoreWindow: (
    window: RestorePlan["windows"][number],
    record: (outcome: RestoreTabOutcome) => Promise<void>,
  ) => Promise<RestoreTabOutcome[]>;
  now: () => Date;
  createId: () => string;
  /** Network and tab access for account commands; absent in tests that don't need them. */
  account?: Omit<AccountDeps, "db" | "now" | "createId">;
  /** Jitter source and retry alarm for uploads; absent in tests that don't need them. */
  sync?: Pick<SyncDeps, "random" | "scheduleRetry">;
}

export class BrowserError extends Error {
  override name = "BrowserError";
}

const fail = (code: ErrorCode, message: string): CommandResponse => ({ ok: false, error: { code, message } });

/** What a quota failure means for each command (nothing was written in every case). */
const NOT_DONE: Record<Command["type"], string> = {
  "session.capture": "this wasn't saved",
  "session.rename": "the new name wasn't saved",
  "session.delete": "nothing was deleted",
  "session.import": "this file wasn't imported",
  "restore.start": "the restore couldn't start and nothing was opened",
  "restore.retry": "the retry couldn't start and nothing was opened",
  "recovery.restore": "the restore couldn't start and nothing was opened",
  "recovery.checkpointNow": "the checkpoint wasn't saved",
  "account.status": "the account status couldn't be read",
  "account.connect": "the connection wasn't started",
  "account.poll": "the connection wasn't saved",
  "account.cancel": "the request wasn't cancelled",
  "account.check": "the connection couldn't be checked",
  "account.disconnect": "this browser wasn't disconnected",
  "sync.now": "nothing was synced",
};

const toErrorResponse = (error: unknown, type: Command["type"]): CommandResponse => {
  if (error instanceof RestoreRecordingError) return fail("storage-full", error.message);
  if (isQuotaError(error)) return fail("storage-full", `Storage for SessionHub is full, so ${NOT_DONE[type]}. ${STORAGE_FULL_HINT}`);
  if (error instanceof VersionConflictError || error instanceof SessionExistsError) return fail("conflict", error.message);
  if (error instanceof SessionNotFoundError || error instanceof RestoreJobNotFoundError) return fail("not-found", error.message);
  if (error instanceof RestoreJobNotRetryableError) return fail("conflict", error.message);
  if (error instanceof InvalidSessionNameError || error instanceof CaptureLimitError || error instanceof SessionImportError) {
    return fail("invalid-input", error.message);
  }
  if (error instanceof BrowserError) return fail("browser-error", error.message);
  if (error instanceof AccountApiError) return fail("account-error", error.message);
  return fail("storage-error", error instanceof Error ? error.message : "Unexpected error");
};

const capture = async (command: Extract<Command, { type: "session.capture" }>, deps: HandlerDeps) => {
  const windows = await deps.readWindows(command.scope);
  const now = deps.now();
  const device = await getOrCreateDevice(deps.db, deps.createId, now);
  const { session, report } = buildSavedSession(windows, {
    name: defaultSessionName(command.scope.kind, now),
    now,
    device: { id: device.installationId, name: device.friendlyName },
    createId: deps.createId,
  });
  if (report.tabCount === 0) throw new BrowserError("There are no tabs to save in this window");
  await putSession(deps.db, session);
  return { sessionId: session.id, report };
};

/** Re-validates untrusted file text and inserts it as a brand-new session (never an overwrite). */
const importSession = async (command: Extract<Command, { type: "session.import" }>, deps: HandlerDeps) => {
  const { session, report } = prepareImportedSession(parseSessionExport(command.content), {
    now: deps.now(),
    createId: deps.createId,
  });
  await addSession(deps.db, session);
  return { sessionId: session.id, report };
};

/**
 * Writes each outcome as soon as `restoreWindow` reports it, so a worker killed mid-window
 * loses at most the tab it was opening (a retry reopens any opened tab it lost). Outcomes
 * it returned without reporting are written when the window is done.
 */
const restoreAndRecordWindow = async (jobId: string, window: RestorePlan["windows"][number], deps: HandlerDeps) => {
  const recorded = new Set<string>();
  const outcomes = await deps.restoreWindow(window, async (outcome) => {
    await appendRestoreOutcomes(deps.db, jobId, [outcome], deps.now());
    recorded.add(outcome.sourceTabId);
  });
  const unrecorded = outcomes.filter((outcome) => !recorded.has(outcome.sourceTabId));
  if (unrecorded.length > 0) await appendRestoreOutcomes(deps.db, jobId, unrecorded, deps.now());
};

/**
 * Opens each planned window and records outcomes. The job status is always settled
 * from recorded outcomes, even if a step throws, so a job never stays "running" and
 * blocks retry. (A worker killed mid-run can't settle it; the next worker start does.)
 */
const runRestoreJob = async (jobId: string, plan: RestorePlan, deps: HandlerDeps) => {
  let failure: unknown = null;
  try {
    for (const window of plan.windows) await restoreAndRecordWindow(jobId, window, deps);
  } catch (error) {
    // Once a tab has been opened, a full disk means its outcome couldn't be recorded:
    // stop opening more tabs and say so, rather than claiming nothing happened.
    failure = isQuotaError(error) ? new RestoreRecordingError() : error;
  }
  if (failure) {
    // Best effort: settling may fail for the same reason; keep the original error.
    await finishRestoreJob(deps.db, jobId, deps.now()).catch(() => undefined);
    throw failure;
  }
  return finishRestoreJob(deps.db, jobId, deps.now());
};

const restoreFrom = async (session: SavedSession, tabIds: string[] | undefined, deps: HandlerDeps) => {
  const plan = planRestore(session, tabIds ? { tabIds: new Set(tabIds) } : {});
  const job = await createRestoreJob(deps.db, { id: deps.createId(), plan, now: deps.now() });
  return { job: await runRestoreJob(job.id, plan, deps) };
};

const restore = async (command: Extract<Command, { type: "restore.start" }>, deps: HandlerDeps) => {
  const session = await getSession(deps.db, command.sessionId);
  if (!session) throw new SessionNotFoundError("Session no longer exists");
  return restoreFrom(session, command.tabIds, deps);
};

/** Recovery checkpoints restore through the same planner, job and retry flow as sessions. */
const restoreCheckpoint = async (command: Extract<Command, { type: "recovery.restore" }>, deps: HandlerDeps) => {
  const snapshot = await getSnapshot(deps.db, command.snapshotId);
  if (!snapshot) throw new SessionNotFoundError("This checkpoint was removed by retention");
  return restoreFrom(snapshot.session, command.tabIds, deps);
};

/** Re-runs only tabs that never opened, in new windows. Works from the stored plan, not the session. */
const retry = async (command: Extract<Command, { type: "restore.retry" }>, deps: HandlerDeps) => {
  const job = await claimRestoreJobForRetry(deps.db, command.jobId, deps.now());
  return { job: await runRestoreJob(job.id, planRetry(job.plan, openedTabIds(job)), deps) };
};

const accountDeps = (deps: HandlerDeps): AccountDeps => {
  if (!deps.account) throw new BrowserError("Account features aren't available here");
  return { ...deps.account, db: deps.db, now: deps.now, createId: deps.createId };
};

/** Everything the uploader needs, from the worker's handler dependencies. */
export const toSyncDeps = (deps: HandlerDeps): SyncDeps => {
  if (!deps.sync) throw new BrowserError("Sync isn't available here");
  return { ...deps.sync, db: deps.db, now: deps.now, account: accountDeps(deps) };
};

type AccountCommand = Extract<Command, { type: `account.${string}` }>;

const runAccountCommand = async (command: AccountCommand, deps: HandlerDeps): Promise<CommandResponse> => {
  const account = accountDeps(deps);
  switch (command.type) {
    case "account.status":
      return { ok: true, data: await getAccountStatus(account) };
    case "account.connect":
      return { ok: true, data: await startPairing(account) };
    case "account.poll":
      return { ok: true, data: await pollPairing(account) };
    case "account.cancel":
      return { ok: true, data: await cancelPairing(account) };
    case "account.check":
      return { ok: true, data: await checkConnection(account) };
    case "account.disconnect":
      return { ok: true, data: await disconnect(account) };
  }
};

/** Validates an untrusted message and runs the matching command. Never throws. */
export const handleCommand = async (message: unknown, deps: HandlerDeps): Promise<CommandResponse> => {
  const parsed = commandSchema.safeParse(message);
  if (!parsed.success) return fail("invalid-command", "Unrecognized or malformed command");
  const command = parsed.data;
  try {
    switch (command.type) {
      case "session.capture":
        return { ok: true, data: await capture(command, deps) };
      case "session.rename": {
        const now = deps.now();
        const updated = await updateSession(
          deps.db,
          command.sessionId,
          command.expectedVersion,
          (session) => renameSession(session, command.name, now),
          { now, createId: deps.createId },
        );
        return { ok: true, data: { version: updated.version } };
      }
      case "session.delete":
        await deleteSession(deps.db, command.sessionId, { now: deps.now(), createId: deps.createId });
        return { ok: true, data: {} };
      case "session.import":
        return { ok: true, data: await importSession(command, deps) };
      case "restore.start":
        return { ok: true, data: await restore(command, deps) };
      case "restore.retry":
        return { ok: true, data: await retry(command, deps) };
      case "recovery.restore":
        return { ok: true, data: await restoreCheckpoint(command, deps) };
      case "recovery.checkpointNow": {
        const result = await runCheckpoint(deps, { force: true, reason: "manual" });
        if (result.status === "error") {
          return fail(result.storageFull ? "storage-full" : "browser-error", result.message);
        }
        if (result.status === "clean") return { ok: true, data: { status: "clean", snapshotId: null, freedForSpace: 0 } };
        return { ok: true, data: { status: result.status, snapshotId: result.snapshotId, freedForSpace: result.freedForSpace } };
      }
      case "sync.now":
        return { ok: true, data: await syncNow(toSyncDeps(deps), { force: true }) };
      default:
        return await runAccountCommand(command, deps);
    }
  } catch (error) {
    return toErrorResponse(error, command.type);
  }
};
