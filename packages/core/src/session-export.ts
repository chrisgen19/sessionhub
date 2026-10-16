import type { SavedSession } from "@sessionhub/contracts/session";
import { SESSION_EXPORT_FORMAT, type SessionExport } from "@sessionhub/contracts/session-export";

export const createSessionExport = (session: SavedSession, now: Date): SessionExport => ({
  format: SESSION_EXPORT_FORMAT,
  schemaVersion: session.schemaVersion,
  exportedAt: now.toISOString(),
  session,
});

/** Filesystem-safe export name, e.g. "sessionhub-frontend-research-2026-10-16.json". */
export const exportFileName = (session: SavedSession, now: Date): string => {
  const slug =
    session.name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "session";
  return `sessionhub-${slug}-${now.toISOString().slice(0, 10)}.json`;
};
