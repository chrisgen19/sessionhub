import { SESSION_LIMITS, type SavedSession } from "@sessionhub/contracts/session";

/**
 * Pure rules for reviewing a change the server didn't accept (docs/SYNC_PROTOCOL.md section 9).
 * Nothing resolves on its own: the device keeps both sides until the user picks one of the choices
 * offered for the situation, and every choice keeps at least one copy of the user's work.
 */

export type ReviewKind =
  /** Edited here and elsewhere: the server has a newer version. */
  | "edit-conflict"
  /** Edited here, but deleted on the server (a tombstone can't be edited back). */
  | "deleted-on-server"
  /** Deleted here, but edited elsewhere. */
  | "delete-conflict"
  /** Its id is taken on the server by a session that isn't this one. */
  | "id-in-use"
  /** The server can never accept it as it is (invalid or too large). */
  | "rejected";

export type ReviewChoice =
  /** Upload this browser's version over the server's (or, where the server's is gone, as a new session). */
  | "keep-mine"
  /** Take the server's version (or its delete) and drop this browser's change. */
  | "keep-server"
  /** Take the server's version and keep this browser's as a separate new session. */
  | "save-both"
  /** Stop syncing it: back to this browser only. */
  | "local-only";

export interface ReviewInput {
  /** The first held operation of the session: its action and the server's answer. */
  operation: { action: "upsert" | "delete"; status: "conflict" | "rejected"; code: string | null };
  hasLocalRecord: boolean;
  /** The server state held while the change waited, if it has arrived. */
  serverCopy: { action: "upsert" | "delete"; version: number } | null;
  /** The server version the conflict reported, when the server copy hasn't arrived yet. */
  conflictServerVersion: number | null;
}

export const classifyReview = (input: ReviewInput): ReviewKind => {
  const { operation, serverCopy } = input;
  if (operation.action === "delete") return "delete-conflict";
  if (operation.code === "ID_IN_USE") return "id-in-use";
  if (operation.status === "conflict") return serverCopy?.action === "delete" ? "deleted-on-server" : "edit-conflict";
  if (operation.code === "NOT_FOUND") return "deleted-on-server";
  return "rejected";
};

/** The server version a "keep mine" builds on, if known: the held copy's, else the conflict's. */
export const serverVersionOf = (input: ReviewInput): number | null => input.serverCopy?.version ?? input.conflictServerVersion;

/**
 * Choices that can be carried out right now. Taking the server's version needs its copy; uploading
 * over it needs its version number; until those arrive (Sync now) fewer choices are offered.
 */
export const reviewChoices = (kind: ReviewKind, input: ReviewInput): ReviewChoice[] => {
  const serverUpsert = input.serverCopy?.action === "upsert";
  const known = serverVersionOf(input) !== null;
  // Keeping this browser's version needs it to still exist here (it may have been deleted since).
  // Once it was deleted here, a refused upload can only be dropped (nothing is sent).
  const mine = input.hasLocalRecord;
  const choices: Record<ReviewKind, [ReviewChoice, boolean][]> = {
    "edit-conflict": [["keep-mine", mine && known], ["keep-server", serverUpsert], ["save-both", mine && serverUpsert]],
    "deleted-on-server": [["keep-mine", mine], ["keep-server", true]],
    "delete-conflict": [["keep-server", serverUpsert], ["keep-mine", known]],
    "id-in-use": [["keep-mine", mine], ["local-only", mine], ["keep-server", !mine]],
    rejected: [["local-only", mine], ["keep-server", !mine]],
  };
  return choices[kind].filter(([, available]) => available).map(([choice]) => choice);
};

/**
 * A copy of a session as a new, separate session: new ids for the session, its windows, groups and
 * tabs (group links remapped), version 1, timestamps now. Used when this browser's version has to
 * live on next to (or instead of) one the server owns.
 */
export const copyAsNewSession = (session: SavedSession, { createId, now, name = session.name }: { createId: () => string; now: Date; name?: string }): SavedSession => ({
  ...session,
  id: createId(),
  name: name.slice(0, SESSION_LIMITS.nameMax),
  version: 1,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  windows: session.windows.map((window) => {
    const groupIds = new Map(window.groups.map((group) => [group.id, createId()]));
    return {
      ...window,
      id: createId(),
      groups: window.groups.map((group) => ({ ...group, id: groupIds.get(group.id) ?? createId() })),
      tabs: window.tabs.map((tab) => ({ ...tab, id: createId(), groupId: tab.groupId === null ? null : (groupIds.get(tab.groupId) ?? null) })),
    };
  }),
});

/** Name of this browser's version when both are kept, fitted to the name limit. */
export const keptCopyName = (name: string): string => {
  const suffix = " (this browser's version)";
  return `${name.slice(0, SESSION_LIMITS.nameMax - suffix.length)}${suffix}`;
};
