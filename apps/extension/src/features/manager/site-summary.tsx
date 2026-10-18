import { useMemo } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { duplicateTabIds, topSites } from "@sessionhub/core/session-summary";
import { plural } from "../../lib/format";

const SITES_SHOWN = 3;

/** Where the session's tabs are from, and how many are extra copies of the same page. */
export function SiteSummary({ session }: { session: SavedSession }) {
  const sites = useMemo(() => topSites(session, SITES_SHOWN), [session]);
  const duplicates = useMemo(() => duplicateTabIds(session).size, [session]);
  if (sites.length === 0 && duplicates === 0) return null;
  return (
    <p className="text-xs text-fg-muted">
      {sites.length > 0 && (
        <>
          Most tabs from{" "}
          {sites.map((entry, index) => (
            <span key={entry.site}>
              {index > 0 && (index === sites.length - 1 ? " and " : ", ")}
              <span className="font-semibold text-fg">{entry.site}</span> ({entry.count})
            </span>
          ))}
          .{" "}
        </>
      )}
      {duplicates > 0 && `${plural(duplicates, "tab")} ${duplicates === 1 ? "is a copy" : "are copies"} of another tab in this session.`}
    </p>
  );
}
