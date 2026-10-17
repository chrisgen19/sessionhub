import { useCallback, useEffect, useState } from "react";

/** The workspace filter value for sessions in no workspace (workspace ids are UUIDs). */
export const NO_WORKSPACE = "none";

export type ManagerRoute =
  /** `workspace`: a workspace id, NO_WORKSPACE, or null for all sessions. */
  | { view: "sessions"; sessionId: string | null; workspace: string | null }
  | { view: "recovery"; snapshotId: string | null }
  | { view: "open-tabs" }
  | { view: "account" };

/**
 * `#session=<id>` (popup deep link), `#workspace=<id|none>&session=<id>`, `#view=recovery`,
 * `#view=recovery&snapshot=<id>`, `#view=open-tabs` (the save picker), `#view=account`.
 */
const parse = (): ManagerRoute => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (params.get("view") === "account") return { view: "account" };
  if (params.get("view") === "open-tabs") return { view: "open-tabs" };
  return params.get("view") === "recovery"
    ? { view: "recovery", snapshotId: params.get("snapshot") }
    : { view: "sessions", sessionId: params.get("session"), workspace: params.get("workspace") };
};

export const routeHref = (route: ManagerRoute): string => {
  if (route.view === "account") return "#view=account";
  if (route.view === "open-tabs") return "#view=open-tabs";
  if (route.view === "recovery") {
    return `#view=recovery${route.snapshotId ? `&snapshot=${encodeURIComponent(route.snapshotId)}` : ""}`;
  }
  const params = [route.workspace && `workspace=${encodeURIComponent(route.workspace)}`, route.sessionId && `session=${encodeURIComponent(route.sessionId)}`].filter(Boolean);
  return params.length > 0 ? `#${params.join("&")}` : "#";
};

/** Manager view and selection, mirrored in the URL hash. */
export function useManagerRoute(): [ManagerRoute, (route: ManagerRoute) => void] {
  const [route, setRoute] = useState<ManagerRoute>(parse);

  useEffect(() => {
    const onHashChange = () => setRoute(parse());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((next: ManagerRoute) => {
    const href = routeHref(next);
    window.history.replaceState(null, "", href === "#" ? window.location.pathname : href);
    setRoute(next);
  }, []);

  return [route, navigate];
}
