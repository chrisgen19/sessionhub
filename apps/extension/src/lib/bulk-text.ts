import { plural } from "./format";
import type { BulkAction, BulkResult } from "./session-organize";

/** What a bulk action did, for the status line under the list's bulk bar. `workspace`: the target's name. */
export const bulkResultText = (action: BulkAction, result: BulkResult, workspace: string | null = null): string => {
  const sessions = plural(result.changed, "session");
  const parts: string[] = [];
  switch (action.kind) {
    case "delete":
      parts.push(`Deleted ${sessions}.`);
      break;
    case "archive":
      parts.push(result.changed === 0 ? `Nothing changed: they were already ${action.archived ? "archived" : "active"}.` : `${action.archived ? "Archived" : "Unarchived"} ${sessions}.`);
      break;
    case "tag":
      parts.push(action.add ? `Tagged ${sessions} “${action.tag.trim()}”.` : `Removed “${action.tag.trim()}” from ${sessions}.`);
      if (result.tooManyTags > 0) parts.push(`${plural(result.tooManyTags, "session")} already ${result.tooManyTags === 1 ? "has" : "have"} the most tags allowed.`);
      break;
    case "assign":
      parts.push(action.workspaceId === null ? `Took ${sessions} out of their workspace.` : `Moved ${sessions} to ${workspace ?? "the workspace"}.`);
      if (result.notInAccount > 0) {
        parts.push(`${plural(result.notInAccount, "session")} only in this browser stayed where ${result.notInAccount === 1 ? "it was" : "they were"}.`);
      }
      break;
  }
  return parts.join(" ");
};
