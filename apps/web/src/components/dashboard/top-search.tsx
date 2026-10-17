"use client";

import { Search } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";

const noSubscription = () => () => {};
const platformShortcut = () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘ K" : "Ctrl K");

/**
 * Global search: submits to Saved sessions (`/app/sessions?q=`). Ctrl+K / Cmd+K focuses it;
 * the shortcut is ignored while typing in another field so normal editing isn't hijacked.
 */
export function TopSearch() {
  const input = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const params = useSearchParams();
  // Show the active query while on Saved sessions; empty elsewhere.
  const query = pathname === "/app/sessions" ? (params.get("q") ?? "") : "";
  // "Ctrl K" on the server and first paint; "⌘ K" on Apple platforms after hydration.
  const shortcut = useSyncExternalStore(noSubscription, platformShortcut, () => "Ctrl K");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target && target !== input.current && target.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form action="/app/sessions" role="search" className="w-full max-w-md">
      <label className="flex h-10 items-center gap-2 rounded-lg border border-line bg-canvas px-3 focus-within:outline-2 focus-within:outline-focus">
        <Search aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
        <span className="sr-only">Search saved sessions</span>
        <input
          ref={input}
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
