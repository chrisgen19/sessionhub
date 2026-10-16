import { buildSavedSession, CaptureLimitError, type CaptureWindowInput } from "@sessionhub/core/capture";
import { defaultSessionName } from "@sessionhub/core/naming";
import { planRestore, type RestorePlan } from "@sessionhub/core/restore-plan";
import { InvalidSessionNameError, renameSession } from "@sessionhub/core/session-edit";
import { parseSessionExport, prepareImportedSession, SessionImportError } from "@sessionhub/core/session-import";
import type { RestoreTabOutcome, SessionHubDb } from "./db";
import { getOrCreateDevice } from "./device-repository";
import { commandSchema, type Command, type CommandResponse, type ErrorCode } from "./messages";
import { appendRestoreOutcomes, createRestoreJob, finishRestoreJob } from "./restore-job-repository";
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
  /** Opens one planned window; reports per-tab outcomes and never touches existing windows. */
  restoreWindow: (window: RestorePlan["windows"][number]) => Promise<RestoreTabOutcome[]>;
  now: () => Date;
  createId: () => string;
}

export class BrowserError extends Error {
  override name = "BrowserError";
}

const fail = (code: ErrorCode, message: string): CommandResponse => ({ ok: false, error: { code, message } });

const toErrorResponse = (error: unknown): CommandResponse => {
  if (error instanceof VersionConflictError || error instanceof SessionExistsError) return fail("conflict", error.message);
  if (error instanceof SessionNotFoundError) return fail("not-found", error.message);
  if (error instanceof InvalidSessionNameError || error instanceof CaptureLimitError || error instanceof SessionImportError) {
    return fail("invalid-input", error.message);
  }
  if (error instanceof BrowserError) return fail("browser-error", error.message);
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

const restore = async (command: Extract<Command, { type: "restore.start" }>, deps: HandlerDeps) => {
  const session = await getSession(deps.db, command.sessionId);
  if (!session) throw new SessionNotFoundError("Session no longer exists");
  const plan = planRestore(session, command.tabIds ? { tabIds: new Set(command.tabIds) } : {});
  const job = await createRestoreJob(deps.db, { id: deps.createId(), plan, now: deps.now() });
  for (const window of plan.windows) {
    const outcomes = await deps.restoreWindow(window);
    await appendRestoreOutcomes(deps.db, job.id, outcomes, deps.now());
  }
  return { job: await finishRestoreJob(deps.db, job.id, deps.now()) };
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
        const updated = await updateSession(deps.db, command.sessionId, command.expectedVersion, (session) =>
          renameSession(session, command.name, deps.now()),
        );
        return { ok: true, data: { version: updated.version } };
      }
      case "session.delete":
        await deleteSession(deps.db, command.sessionId);
        return { ok: true, data: {} };
      case "session.import":
        return { ok: true, data: await importSession(command, deps) };
      case "restore.start":
        return { ok: true, data: await restore(command, deps) };
    }
  } catch (error) {
    return toErrorResponse(error);
  }
};
