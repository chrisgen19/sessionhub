import { useCallback, useEffect, useState } from "react";

export type ManagerRoute =
  | { view: "sessions"; sessionId: string | null }
  | { view: "recovery"; snapshotId: string | null };

/** `#session=<id>` (popup deep link), `#view=recovery`, `#view=recovery&snapshot=<id>`. */
const parse = (): ManagerRoute => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return params.get("view") === "recovery"
    ? { view: "recovery", snapshotId: params.get("snapshot") }
    : { view: "sessions", sessionId: params.get("session") };
};

export const routeHref = (route: ManagerRoute): string => {
  if (route.view === "recovery") {
    return `#view=recovery${route.snapshotId ? `&snapshot=${encodeURIComponent(route.snapshotId)}` : ""}`;
  }
  return route.sessionId ? `#session=${encodeURIComponent(route.sessionId)}` : "#";
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
