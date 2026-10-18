import { useState } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import type { SessionDetails } from "@sessionhub/core/session-organize";
import { sendCommand } from "../lib/message-client";

/**
 * Saves a change to a session's notes, tags, pinned or archived, guarded by the version on screen
 * (a newer edit from another page is refused, not overwritten). `edit` resolves to whether it saved.
 */
export function useSessionEdit(session: SavedSession) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edit = async (patch: Partial<SessionDetails>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const response = await sendCommand({ type: "session.edit", sessionId: session.id, expectedVersion: session.version, ...patch });
    setBusy(false);
    if (!response.ok) setError(response.error.message);
    return response.ok;
  };
  return { busy, error, edit, clearError: () => setError(null) };
}
