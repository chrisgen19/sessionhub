import { SESSION_LIMITS, type SavedSession } from "@sessionhub/contracts/session";

export class InvalidSessionNameError extends Error {
  override name = "InvalidSessionNameError";
}

/** Returns a renamed copy with a bumped version; throws on blank or overlong names. */
export const renameSession = (session: SavedSession, name: string, now: Date): SavedSession => {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new InvalidSessionNameError("Name can't be empty");
  if (trimmed.length > SESSION_LIMITS.nameMax) {
    throw new InvalidSessionNameError(`Name must be ${SESSION_LIMITS.nameMax} characters or fewer`);
  }
  if (trimmed === session.name) return session;
  return { ...session, name: trimmed, version: session.version + 1, updatedAt: now.toISOString() };
};
