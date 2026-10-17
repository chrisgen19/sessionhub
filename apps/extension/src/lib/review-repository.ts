import { Dexie } from "dexie";
import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import type { SavedSession } from "@sessionhub/contracts/session";
import { classifyReview, copyAsNewSession, keptCopyName, reviewChoices, type ReviewChoice, type ReviewInput, type ReviewKind } from "@sessionhub/sync/review";
import { activeAccountScope } from "./account-scope";
import type { AccountScope, LocalSessionRecord, OutboxRecord, ServerCopyRecord, SessionHubDb } from "./db";
import { enqueueSessionDelete, enqueueSessionUpsert, type OutboxContext } from "./outbox-repository";
import { SyncUnavailableError } from "./sync-consent";
import { writeServerSession } from "./sync-apply";

/** One session whose change the server didn't accept, with both sides for comparison. */
export interface ReviewItem {
  sessionId: string;
  kind: ReviewKind;
  /** What can be done now (fewer while the server's version is still downloading). */
  choices: ReviewChoice[];
  /** This browser's version; null if it was deleted here. */
  local: SavedSession | null;
  /** The server's version, once downloaded; null if it hasn't arrived or the server deleted it. */
  server: ApiSessionDetail | null;
  serverDeleted: boolean;
  /** The server's explanation, as returned with the refusal. */
  message: string | null;
  detectedAt: string;
}

export class ReviewGoneError extends Error {
  override name = "ReviewGoneError";
}

const toSaved = ({ scope: _scope, sync: _sync, workspaceId: _workspaceId, ...session }: LocalSessionRecord): SavedSession => session;

/** Builds the item for one session from its first held operation (direct Dexie awaits). */
const reviewItemFor = async (db: SessionHubDb, scope: AccountScope, held: OutboxRecord): Promise<ReviewItem> => {
  const record = await db.sessions.get(held.entityId);
  const copy = await db.serverCopies.get(held.entityId);
  const local = record?.scope === scope ? toSaved(record) : null;
  const serverCopy = copy?.scope === scope ? copy : undefined;
  const input: ReviewInput = {
    operation: { action: held.action, status: held.status === "conflict" ? "conflict" : "rejected", code: held.lastErrorCode ?? null },
    hasLocalRecord: local !== null,
    serverCopy: serverCopy ? { action: serverCopy.action, version: serverCopy.version } : null,
    conflictServerVersion: held.conflictServerVersion ?? null,
  };
  const kind = classifyReview(input);
  return {
    sessionId: held.entityId,
    kind,
    choices: reviewChoices(kind, input),
    local,
    server: serverCopy?.payload ?? null,
    serverDeleted: serverCopy?.action === "delete",
    message: held.lastError,
    detectedAt: held.updatedAt,
  };
};

const heldOperations = async (db: SessionHubDb, scope: AccountScope): Promise<OutboxRecord[]> => {
  const operations = await db.outbox.where("[scope+seq]").between([scope, Dexie.minKey], [scope, Dexie.maxKey]).toArray();
  const firstHeld = new Map<string, OutboxRecord>();
  for (const operation of operations) {
    // Workspaces never need review (13j): their refusals resolve on their own or show on the workspace.
    if (operation.entityType !== "savedSession") continue;
    if ((operation.status === "conflict" || operation.status === "rejected") && !firstHeld.has(operation.entityId)) firstHeld.set(operation.entityId, operation);
  }
  return [...firstHeld.values()];
};

/** Every change of the connected account waiting for review, oldest first. Safe inside liveQuery. */
export const listReviewItems = async (db: SessionHubDb): Promise<ReviewItem[]> => {
  const scope = activeAccountScope(await db.account.get("connection"));
  if (!scope) return [];
  const items: ReviewItem[] = [];
  for (const held of await heldOperations(db, scope)) items.push(await reviewItemFor(db, scope, held));
  return items;
};

interface Resolution {
  db: SessionHubDb;
  scope: AccountScope;
  sessionId: string;
  item: ReviewItem;
  copy: ServerCopyRecord | undefined;
  record: LocalSessionRecord | undefined;
  /** The server version to build on: the held copy's, else the one the conflict reported. */
  version: number | null;
  context: OutboxContext;
}

/** This browser's workspace for the session, if it knows one (absent leaves the server's as it is). */
const workspaceOf = (record: LocalSessionRecord | undefined) => (record?.workspaceId === undefined ? {} : { workspaceId: record.workspaceId });

/** Puts a session into the account as a brand-new session with its create queued, in this browser's workspace for it. */
const addAsNew = async ({ db, scope, context, record }: Resolution, session: SavedSession) => {
  const workspace = record?.scope === scope ? workspaceOf(record) : {};
  await db.sessions.add({ ...session, ...workspace, scope, sync: { serverVersion: null, state: "pending" } });
  await enqueueSessionUpsert(db, scope, { ...session, ...workspace }, null, context);
};

const takeServer = async ({ db, scope, sessionId, copy, record }: Resolution) => {
  if (copy?.payload) await writeServerSession(db, scope, copy.payload, copy.version, record);
  await db.sessionTombstones.delete(sessionId);
};

const forgetHere = async ({ db, sessionId }: Resolution) => {
  await db.sessions.delete(sessionId);
  await db.serverCopies.delete(sessionId);
};

/**
 * This browser's version is leaving the id. A session of the account that holds it (its copy
 * arrived) is stored under the id: the pull already passed it, so dropping it would hide it here.
 */
const releaseId = async (r: Resolution) => {
  const kept = r.item.server !== null && r.copy !== undefined && (await writeServerSession(r.db, r.scope, r.item.server, r.copy.version, r.record));
  if (!kept) await forgetHere(r);
};

type Handler = (resolution: Resolution) => Promise<string>;

/** Upload this browser's version on top of the server's current one (a new conflict if it moves again). */
const uploadMineOver: Handler = async (r) => {
  if (!r.item.local || r.version === null) throw unavailable();
  await enqueueSessionUpsert(r.db, r.scope, { ...r.item.local, ...workspaceOf(r.record) }, r.version, r.context);
  await r.db.sessions.update(r.sessionId, { sync: { serverVersion: r.version, state: "pending" } });
  await r.db.serverCopies.delete(r.sessionId);
  return r.sessionId;
};

const keepServer: Handler = async (r) => {
  await takeServer(r);
  return r.sessionId;
};

/** The server's version stays under this id; this browser's becomes a separate new session. */
const keepBoth: Handler = async (r) => {
  if (!r.item.local) throw unavailable();
  const mine = copyAsNewSession(r.item.local, { ...r.context, name: keptCopyName(r.item.local.name) });
  await takeServer(r);
  await addAsNew(r, mine);
  return mine.id;
};

/** The original id can't be used any more (deleted on the server, or taken): upload under a new one. */
const reuploadAsNew: Handler = async (r) => {
  if (!r.item.local) throw unavailable();
  const mine = copyAsNewSession(r.item.local, r.context);
  await releaseId(r);
  await addAsNew(r, mine);
  return mine.id;
};

const deleteEverywhere: Handler = async (r) => {
  if (r.version === null) throw unavailable();
  await enqueueSessionDelete(r.db, r.scope, r.sessionId, r.version, r.context);
  await r.db.serverCopies.delete(r.sessionId);
  return r.sessionId;
};

const acceptServerDelete: Handler = async (r) => {
  await forgetHere(r);
  return r.sessionId;
};

/** Stops syncing this browser's version; it moves to new ids when an account session holds the id. */
const backToThisBrowser: Handler = async (r) => {
  if (!r.item.local) throw unavailable();
  if (!r.item.server) {
    await r.db.sessions.put({ ...r.item.local, scope: "local" });
    await r.db.serverCopies.delete(r.sessionId);
    return r.sessionId;
  }
  const mine = copyAsNewSession(r.item.local, r.context);
  await releaseId(r);
  await r.db.sessions.add({ ...mine, scope: "local" });
  return mine.id;
};

/**
 * Deleted here after its upload was refused: the refused change, the delete queued behind it and
 * the tombstone are dropped (resolveReview already removed the operations), so nothing is sent and
 * no server session is deleted. An account session holding the id, if its copy arrived, is kept.
 */
const dropDeletedChange: Handler = async (r) => {
  // A record left under this id belongs to another scope (this account's was deleted): leave it.
  if (r.record) await r.db.serverCopies.delete(r.sessionId);
  else await releaseId(r);
  await r.db.sessionTombstones.delete(r.sessionId);
  return r.sessionId;
};

const HANDLERS: Record<ReviewKind, Partial<Record<ReviewChoice, Handler>>> = {
  "edit-conflict": { "keep-mine": uploadMineOver, "keep-server": keepServer, "save-both": keepBoth },
  "deleted-on-server": { "keep-mine": reuploadAsNew, "keep-server": acceptServerDelete },
  "delete-conflict": { "keep-mine": deleteEverywhere, "keep-server": keepServer },
  "id-in-use": { "keep-mine": reuploadAsNew, "local-only": backToThisBrowser, "keep-server": dropDeletedChange },
  rejected: { "local-only": backToThisBrowser, "keep-server": dropDeletedChange },
};

const unavailable = () => new ReviewGoneError("That choice isn't available for this change any more. Look at it again.");

/**
 * Carries out the user's choice for one session in one transaction, after re-checking that the
 * choice is still offered (another page may have resolved it, or a newer server copy arrived).
 * Every outcome keeps at least one copy of the user's work. Returns the session to show next
 * (a new id when this browser's version became a separate session).
 */
export const resolveReview = (db: SessionHubDb, sessionId: string, choice: ReviewChoice, context: OutboxContext): Promise<{ sessionId: string }> =>
  db.transaction("rw", [db.account, db.sessions, db.outbox, db.serverCopies, db.sessionTombstones], async () => {
    const scope = activeAccountScope(await db.account.get("connection"));
    if (!scope) throw new SyncUnavailableError("Connect this browser to your account first.");
    const held = (await heldOperations(db, scope)).find((operation) => operation.entityId === sessionId);
    if (!held) throw new ReviewGoneError("This change was already resolved.");
    const item = await reviewItemFor(db, scope, held);
    const handler = HANDLERS[item.kind][choice];
    if (!handler || !item.choices.includes(choice)) throw unavailable();
    const copy = await db.serverCopies.get(sessionId);
    const resolution: Resolution = {
      db,
      scope,
      sessionId,
      item,
      copy,
      record: await db.sessions.get(sessionId),
      version: copy?.version ?? held.conflictServerVersion ?? null,
      context,
    };
    // Every choice replaces the held operation and anything queued after it.
    await db.outbox.where("entityId").equals(sessionId).filter((operation) => operation.scope === scope).delete();
    return { sessionId: await handler(resolution) };
  });
