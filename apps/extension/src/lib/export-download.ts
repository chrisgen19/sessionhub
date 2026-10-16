import type { SavedSession } from "@sessionhub/contracts/session";
import { createSessionExport, exportFileName } from "@sessionhub/core/session-export";

/** Downloads a versioned JSON export via a Blob link; needs no `downloads` permission. */
export const downloadSessionExport = (session: SavedSession, now: Date = new Date()): void => {
  const json = JSON.stringify(createSessionExport(session, now), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFileName(session, now);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
