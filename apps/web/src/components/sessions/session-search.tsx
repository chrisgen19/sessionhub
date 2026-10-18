"use client";

import { Search } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";

const noSubscription = () => () => {};
const platformShortcut = () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘ K" : "Ctrl K");

/** The id the dashboard's Ctrl/Cmd+K shortcut focuses (components/dashboard/search-shortcut.tsx). */
export const SESSION_SEARCH_ID = "session-search";

interface SessionSearchProps {
  query: string;
  archived: boolean;
  /** Kept while searching: the list's current workspace filter (already checked). */
  workspace: string | null;
}

/**
 * Searches saved sessions by name through the URL (`?q=`), keeping the view and workspace. Arriving
 * from the shortcut on another page (`#search`) focuses it.
 */
export function SessionSearch({ query, archived, workspace }: SessionSearchProps) {
  const input = useRef<HTMLInputElement>(null);
  // "Ctrl K" on the server and first paint; "⌘ K" on Apple platforms after hydration.
  const shortcut = useSyncExternalStore(noSubscription, platformShortcut, () => "Ctrl K");
  useEffect(() => {
    if (window.location.hash === "#search") input.current?.focus();
  }, []);

  return (
    <form action="/app/sessions" role="search">
      {archived && <input type="hidden" name="view" value="archived" />}
      {workspace && <input type="hidden" name="workspace" value={workspace} />}
      <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-canvas px-3 focus-within:outline-2 focus-within:outline-focus">
        <Search aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
        <span className="sr-only">Search saved sessions</span>
        <input
          ref={input}
          id={SESSION_SEARCH_ID}
          key={query}
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search saved sessions"
          className="h-full w-full bg-transparent text-[13px] outline-none placeholder:text-fg-muted"
        />
        <kbd className="hidden shrink-0 rounded border border-line px-1.5 text-[10px] text-fg-muted sm:inline">{shortcut}</kbd>
      </label>
    </form>
  );
}
