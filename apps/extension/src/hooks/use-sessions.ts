import { liveQuery } from "dexie";
import { useCallback, useEffect, useState } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { getDb } from "../lib/db";
import { listSessions } from "../lib/session-repository";

export type SessionsState =
  | { status: "loading" }
  | { status: "ready"; sessions: SavedSession[] }
  | { status: "error"; message: string };

/**
 * Live list of saved sessions. Dexie's liveQuery re-runs when IndexedDB changes in
 * any extension context (including writes made by the background worker).
 */
export function useSessions(): { state: SessionsState; retry: () => void } {
  const [state, setState] = useState<SessionsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const subscription = liveQuery(() => listSessions(getDb())).subscribe({
      next: (sessions) => setState({ status: "ready", sessions }),
      error: (error: unknown) =>
        setState({ status: "error", message: error instanceof Error ? error.message : "Couldn't load sessions" }),
    });
    return () => subscription.unsubscribe();
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  return { state, retry };
}
