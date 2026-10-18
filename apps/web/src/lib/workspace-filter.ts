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

export interface SessionsQuery {
  query: string;
  archived: boolean;
  /** As requested: still to be checked against the user's workspaces (parseWorkspaceFilter). */
  workspace: string | null;
}

/** The list's search, view and workspace from a page's `searchParams`, bounded but not yet checked. */
export const readSessionsQuery = (params: Record<string, string | string[] | undefined>): SessionsQuery => ({
  query: typeof params.q === "string" ? params.q.trim().slice(0, 200) : "",
  archived: params.view === "archived",
  workspace: typeof params.workspace === "string" ? params.workspace : null,
});

/**
 * The sessions URL for a view, search and workspace filter (defaults left out). With `id`, that
 * session open beside the same list, so opening one keeps the list as it was.
 */
export const sessionsHref = ({ archived, query, workspace, id }: { archived: boolean; query: string; workspace: string | null; id?: string }): string => {
  const params = new URLSearchParams({
    ...(archived ? { view: "archived" } : {}),
    ...(workspace ? { workspace } : {}),
    ...(query ? { q: query } : {}),
  });
  return `/app/sessions${id ? `/${encodeURIComponent(id)}` : ""}${params.size ? `?${params}` : ""}`;
};
