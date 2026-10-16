import { useCallback, useEffect, useState } from "react";

const readHash = (): string | null => new URLSearchParams(window.location.hash.slice(1)).get("session");

/** Selected session id mirrored in `#session=<id>` so the popup can deep-link into the manager. */
export function useSelectedSession(): [string | null, (id: string | null) => void] {
  const [selectedId, setSelectedId] = useState<string | null>(readHash);

  useEffect(() => {
    const onHashChange = () => setSelectedId(readHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const select = useCallback((id: string | null) => {
    const url = id ? `#session=${encodeURIComponent(id)}` : window.location.pathname;
    window.history.replaceState(null, "", url);
    setSelectedId(id);
  }, []);

  return [selectedId, select];
}
