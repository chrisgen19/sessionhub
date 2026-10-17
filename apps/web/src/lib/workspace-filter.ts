/** `?workspace=` value for sessions in no workspace (workspace ids are UUIDs, so it can't clash). */
export const NO_WORKSPACE = "none";

/**
 * The workspace filter from the URL: one of the user's own workspace ids, NO_WORKSPACE, or null for
 * all sessions. Anything else (another user's id, a deleted workspace, garbage) shows all sessions.
 */
export const parseWorkspaceFilter = (value: string | string[] | undefined, ownIds: ReadonlySet<string>): string | null => {
  if (typeof value !== "string") return null;
  return value === NO_WORKSPACE || ownIds.has(value) ? value : null;
};

/** The sessions list URL for a view, search and workspace filter (defaults left out). */
export const sessionsHref = ({ archived, query, workspace }: { archived: boolean; query: string; workspace: string | null }): string => {
  const params = new URLSearchParams({
    ...(archived ? { view: "archived" } : {}),
    ...(workspace ? { workspace } : {}),
    ...(query ? { q: query } : {}),
  });
  return `/app/sessions${params.size ? `?${params}` : ""}`;
};
