import type { LocalSessionRecord, OutboxRecord, SyncStateRecord } from "./db";
import { plural } from "./format";
import type { SyncSummary } from "./sync-runner";

/**
 * What the UI says about sync (docs/UI_UX_DESIGN.md section 13). Pure, so the labels stay
 * truthful and testable: nothing here claims "Synced" without the server having confirmed it.
 */

export type SessionSyncLabel = "local" | "pending" | "synced" | "conflict" | "error" | "paused";

export const SESSION_SYNC_TEXT: Record<SessionSyncLabel, string> = {
  local: "Local only",
  pending: "Waiting to sync",
  synced: "Synced",
  conflict: "Needs review",
  error: "Sync failed",
  paused: "Sync off",
};

/** One session's label: this browser's own, or the account's in its sync state ("Sync off" while sync is off). */
export const sessionSyncLabel = (record: Pick<LocalSessionRecord, "scope" | "sync">, syncEnabled: boolean): SessionSyncLabel => {
  if (record.scope === "local") return "local";
  const state = record.sync?.state ?? "pending";
  if (state === "conflict" || state === "error") return state;
  return syncEnabled ? state : "paused";
};

export type SyncOverview =
  /** Not connected to an account. */
  | { kind: "local-only" }
  /** Connected, but the user hasn't turned sync on in this browser. */
  | { kind: "sync-off"; localSessions: number }
  | {
      kind: "on";
      state: "synced" | "pending" | "review" | "failed" | "offline";
      lastSyncAt: string | null;
      lastError: string | null;
      nextAttemptAt: string | null;
      /** Changes queued or being sent. */
      waiting: number;
      /** Changes the server refused, kept for review (sessions) or shown on the workspace. */
      review: number;
      /** Sessions still only in this browser (can be uploaded). */
      localSessions: number;
    };

/** The overall state for the status chip and the Account view; failures outrank review, then waiting. */
export const syncOverview = (input: { connected: boolean; state: SyncStateRecord | undefined; operations: OutboxRecord[]; localSessions: number }): SyncOverview => {
  if (!input.connected) return { kind: "local-only" };
  const { state } = input;
  if (!state?.enabledAt) return { kind: "sync-off", localSessions: input.localSessions };
  const review = input.operations.filter((operation) => operation.status === "conflict" || operation.status === "rejected").length;
  const waiting = input.operations.length - review;
  const failed = state.failures > 0;
  return {
    kind: "on",
    state: failed ? (state.lastErrorCode === "NETWORK" ? "offline" : "failed") : review > 0 ? "review" : waiting > 0 ? "pending" : "synced",
    lastSyncAt: state.lastSyncAt,
    lastError: failed ? state.lastError : null,
    nextAttemptAt: failed ? state.nextAttemptAt : null,
    waiting,
    review,
    localSessions: input.localSessions,
  };
};

export const OVERVIEW_TEXT = {
  "local-only": "Local only",
  "sync-off": "Sync off",
  synced: "Synced",
  pending: "Waiting to sync",
  review: "Needs review",
  failed: "Sync failed",
  offline: "Offline",
} as const;

export const overviewText = (overview: SyncOverview): string => (overview.kind === "on" ? OVERVIEW_TEXT[overview.state] : OVERVIEW_TEXT[overview.kind]);

const retryText = (at: string | null) => (at ? ` It will try again at ${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "");

/** What a "Sync now" run did, in plain words; refused changes are called out, never hidden. */
export const syncNowMessage = ({ push, pull }: SyncSummary): { tone: "ok" | "error"; text: string } => {
  if (push.status === "disconnected") return { tone: "error", text: "This browser isn't connected to an account." };
  if (push.status === "disabled") return { tone: "error", text: "Sync is off. Turn it on first." };
  if (push.status === "error") return { tone: "error", text: `Sync failed: ${push.message}${retryText(push.retryAt)}` };
  if (push.status === "waiting") return { tone: "error", text: `Sync is waiting before trying again.${retryText(push.retryAt)}` };
  if (pull?.status === "error") return { tone: "error", text: `Download failed: ${pull.message}${retryText(pull.retryAt)}` };
  const parts: string[] = [];
  if (push.accepted > 0) parts.push(`uploaded ${plural(push.accepted, "change")}`);
  if (pull?.status === "done" && pull.applied > 0) parts.push(`downloaded ${plural(pull.applied, "change")}`);
  const text = parts.length > 0 ? `Synced: ${parts.join(", ")}.` : "Everything is up to date.";
  const review = push.conflicts + push.rejected;
  return review > 0 ? { tone: "error", text: `${text} ${plural(review, "change")} ${review === 1 ? "needs" : "need"} review.` } : { tone: "ok", text };
};
