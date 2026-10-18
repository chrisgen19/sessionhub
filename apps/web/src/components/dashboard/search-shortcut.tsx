"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SESSION_SEARCH_ID } from "@/components/sessions/session-search";

/**
 * Ctrl+K / Cmd+K from any dashboard page: focuses the Saved sessions search, or goes there first
 * (`#search` focuses it on arrival). Ignored while typing in another field, so editing isn't hijacked.
 */
export function SearchShortcut() {
  const router = useRouter();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      const search = document.getElementById(SESSION_SEARCH_ID);
      if (target && target !== search && target.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      // Hidden (a session open on a narrow screen) counts as absent.
      if (search?.offsetParent) search.focus();
      else router.push("/app/sessions#search");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);
  return null;
}
