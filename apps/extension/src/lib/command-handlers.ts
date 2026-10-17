import { buildSavedSession, CaptureLimitError, type CaptureWindowInput } from "@sessionhub/core/capture";
import { defaultSessionName, selectionSessionName } from "@sessionhub/core/naming";
import { planRestore, planRetry, withoutOpenTabs, type RestorePlan } from "@sessionhub/core/restore-plan";
import { InvalidSessionNameError, normalizeSessionName, renameSession } from "@sessionhub/core/session-edit";
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
import { resolveReview, ReviewGoneError } from "./review-repository";
import { disableSync, enableSync, SyncUnavailableError } from "./sync-consent";
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
import { assignSession, createWorkspace, deleteWorkspace, InvalidWorkspaceError, updateWorkspace, WorkspaceNotFoundError } from "./workspace-repository";
import {
  deleteSession,
  getSession,
  saveNewSession,
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
   * Opens one planned window as a new window, or appends its tabs to the open window `into`;
   * existing tabs are never moved, closed or navigated. Passes each tab's outcome to `record`
   * as soon as it is known (before opening the next tab) and returns them all.
   */
  restoreWindow: (
    window: RestorePlan["windows"][number],
    record: (outcome: RestoreTabOutcome) => Promise<void>,
    options?: { into?: number },
  ) => Promise<RestoreTabOutcome[]>;
  /**
   * URLs open in a normal, non-private window, for restoring into it; throws `BrowserError` when it
   * can't take tabs. Absent in tests that don't restore into an open window.
   */
  inspectWindow?: (windowId: number) => Promise<{ openUrls: string[] }>;
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
  "sync.enable": "sync wasn't turned on and nothing was moved",
  "sync.disable": "sync wasn't turned off",
  "sync.resolve": "nothing was changed",
  "workspace.create": "the workspace wasn't created",
  "workspace.update": "the workspace wasn't changed",
  "workspace.delete": "the workspace wasn't deleted",
  "session.assign": "the session wasn't moved",
};

const toErrorResponse = (error: unknown, type: Command["type"]): CommandResponse => {
  if (error instanceof RestoreRecordingError) return fail("storage-full", error.message);
  if (isQuotaError(error)) return fail("storage-full", `Storage for SessionHub is full, so ${NOT_DONE[type]}. ${STORAGE_FULL_HINT}`);
  if (error instanceof VersionConflictError || error instanceof SessionExistsError) return fail("conflict", error.message);
  if (error instanceof SessionNotFoundError || error instanceof RestoreJobNotFoundError || error instanceof WorkspaceNotFoundError) return fail("not-found", error.message);
  if (error instanceof RestoreJobNotRetryableError || error instanceof ReviewGoneError) return fail("conflict", error.message);
  if (error instanceof InvalidSessionNameError || error instanceof CaptureLimitError || error instanceof SessionImportError || error instanceof InvalidWorkspaceError) {
    return fail("invalid-input", error.message);
  }
  if (error instanceof BrowserError) return fail("browser-error", error.message);
  if (error instanceof AccountApiError || error instanceof SyncUnavailableError) return fail("account-error", error.message);
  return fail("storage-error", error instanceof Error ? error.message : "Unexpected error");
};

const captureName = (command: Extract<Command, { type: "session.capture" }>, windowCount: number, now: Date) => {
  if (command.name !== undefined) return normalizeSessionName(command.name);
  return command.scope.kind === "tabs" ? selectionSessionName(windowCount, now) : defaultSessionName(command.scope.kind, now);
};

/** Saves what the scope names; for the picker's `tabs`, exactly the ticked tabs still open. */
const capture = async (command: Extract<Command, { type: "session.capture" }>, deps: HandlerDeps) => {
  const { scope } = command;
  // Validated before reading the browser, so a bad name never costs a capture.
  if (command.name !== undefined) normalizeSessionName(command.name);
  const windows = await deps.readWindows(scope);
  const now = deps.now();
  const device = await getOrCreateDevice(deps.db, deps.createId, now);
  const { session, report } = buildSavedSession(windows, {
    name: captureName(command, windows.filter((window) => window.tabs.length > 0).length, now),
    now,
    device: { id: device.installationId, name: device.friendlyName },
    createId: deps.createId,
  });
  if (report.tabCount === 0) {
    throw new BrowserError(scope.kind === "tabs" ? "The tabs you chose were closed before saving" : "There are no tabs to save in this window");
  }
  const missing = scope.kind === "tabs" ? Math.max(0, new Set(scope.tabIds).size - report.tabCount) : 0;
  const saved = await saveNewSession(deps.db, session, { now, createId: deps.createId }, { replace: true });
  return { sessionId: session.id, report, syncing: saved !== "local", missing };
};

/** Re-validates untrusted file text and inserts it as a brand-new session (never an overwrite). */
const importSession = async (command: Extract<Command, { type: "session.import" }>, deps: HandlerDeps) => {
  const { session, report } = prepareImportedSession(parseSessionExport(command.content), {
    now: deps.now(),
    createId: deps.createId,
  });
  const scope = await saveNewSession(deps.db, session, { now: deps.now(), createId: deps.createId });
  return { sessionId: session.id, report, syncing: scope !== "local" };
};

/**
 * Writes each outcome as soon as `restoreWindow` reports it, so a worker killed mid-window
 * loses at most the tab it was opening (a retry reopens any opened tab it lost). Outcomes
 * it returned without reporting are written when the window is done.
 */
const restoreAndRecordWindow = async (jobId: string, window: RestorePlan["windows"][number], deps: HandlerDeps, into?: number) => {
  const recorded = new Set<string>();
  const outcomes = await deps.restoreWindow(
    window,
    async (outcome) => {
      await appendRestoreOutcomes(deps.db, jobId, [outcome], deps.now());
      recorded.add(outcome.sourceTabId);
    },
    { into },
  );
  const unrecorded = outcomes.filter((outcome) => !recorded.has(outcome.sourceTabId));
  if (unrecorded.length > 0) await appendRestoreOutcomes(deps.db, jobId, unrecorded, deps.now());
};

/**
 * Opens each planned window and records outcomes. The job status is always settled
 * from recorded outcomes, even if a step throws, so a job never stays "running" and
 * blocks retry. (A worker killed mid-run can't settle it; the next worker start does.)
 */
const runRestoreJob = async (jobId: string, plan: RestorePlan, deps: HandlerDeps, into?: number) => {
  let failure: unknown = null;
  try {
    for (const window of plan.windows) await restoreAndRecordWindow(jobId, window, deps, into);
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

type RestoreCommand = Extract<Command, { type: "restore.start" | "recovery.restore" }>;

/**
 * Plans the chosen tabs for the chosen target and opens them. For the current window, the window
 * is checked (and its URLs read) before the job exists, so a closed window opens nothing.
 */
const restoreFrom = async (session: SavedSession, { tabIds, target = { kind: "new-windows" } }: RestoreCommand, deps: HandlerDeps) => {
  let plan = planRestore(session, {
    ...(tabIds ? { tabIds: new Set(tabIds) } : {}),
    layout: target.kind === "new-windows" ? "original" : "single",
  });
  let into: number | undefined;
  if (target.kind === "this-window") {
    if (!deps.inspectWindow) throw new BrowserError("Opening tabs in this window isn't available here");
    const { openUrls } = await deps.inspectWindow(target.windowId);
    if (target.skipOpen) plan = withoutOpenTabs(plan, new Set(openUrls));
    into = target.windowId;
  }
  const job = await createRestoreJob(deps.db, { id: deps.createId(), plan, now: deps.now(), target: target.kind });
  return { job: await runRestoreJob(job.id, plan, deps, into) };
};

const restore = async (command: Extract<Command, { type: "restore.start" }>, deps: HandlerDeps) => {
  const session = await getSession(deps.db, command.sessionId);
  if (!session) throw new SessionNotFoundError("Session no longer exists");
  return restoreFrom(session, command, deps);
};

/** Recovery checkpoints restore through the same planner, job and retry flow as sessions. */
const restoreCheckpoint = async (command: Extract<Command, { type: "recovery.restore" }>, deps: HandlerDeps) => {
  const snapshot = await getSnapshot(deps.db, command.snapshotId);
  if (!snapshot) throw new SessionNotFoundError("This checkpoint was removed by retention");
  return restoreFrom(snapshot.session, command, deps);
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
      case "sync.enable":
        return { ok: true, data: await enableSync(deps.db, command.sessionIds, { now: deps.now(), createId: deps.createId }) };
      case "sync.disable":
        await disableSync(deps.db);
        return { ok: true, data: {} };
      case "sync.resolve":
        return { ok: true, data: await resolveReview(deps.db, command.sessionId, command.choice, { now: deps.now(), createId: deps.createId }) };
      case "workspace.create":
        return { ok: true, data: await createWorkspace(deps.db, { name: command.name, color: command.color }, { now: deps.now(), createId: deps.createId }) };
      case "workspace.update":
        await updateWorkspace(deps.db, command.workspaceId, { name: command.name, color: command.color }, { now: deps.now(), createId: deps.createId });
        return { ok: true, data: {} };
      case "workspace.delete":
        return { ok: true, data: await deleteWorkspace(deps.db, command.workspaceId, { now: deps.now(), createId: deps.createId }) };
      case "session.assign":
        await assignSession(deps.db, command.sessionId, command.workspaceId, { now: deps.now(), createId: deps.createId });
        return { ok: true, data: {} };
      default:
        return await runAccountCommand(command, deps);
    }
  } catch (error) {
    return toErrorResponse(error, command.type);
  }
};
