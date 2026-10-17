import type { ApiErrorResponse } from "@sessionhub/contracts/api-sessions";

export type Notice = { tone: "ok" | "error" | "conflict"; text: string };

/** User-facing notice for a failed /api/v1 write. Conflicts are never resolved silently. */
export const noticeForError = (error: ApiErrorResponse["error"]): Notice => {
  switch (error.code) {
    case "VERSION_CONFLICT":
      return {
        tone: "conflict",
        text: `This session was changed somewhere else (now version ${error.serverVersion ?? "newer"}). Load the latest version, then make your change again.`,
      };
    case "NOT_FOUND":
      return { tone: "error", text: "This session no longer exists. It may have been deleted elsewhere." };
    case "RATE_LIMITED":
      return {
        tone: "error",
        text: `You're making changes too quickly. Try again in ${error.retryAfterSeconds ?? "a few"} seconds. Nothing was changed.`,
      };
    default:
      return { tone: "error", text: error.message };
  }
};
