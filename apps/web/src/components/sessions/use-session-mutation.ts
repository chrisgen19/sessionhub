"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApiResult } from "@/lib/api-client";

export type Notice = { tone: "ok" | "error" | "conflict"; text: string };

/**
 * Runs one API write and turns the outcome into a notice. Version conflicts are surfaced
 * with the server's current version; nothing is retried or overwritten automatically.
 */
export function useSessionMutation() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const run = async <T>(request: () => Promise<ApiResult<T>>, onSuccess: (data: T) => string | null): Promise<boolean> => {
    setPending(true);
    setNotice(null);
    const result = await request();
    setPending(false);
    if (result.ok) {
      const message = onSuccess(result.data);
      if (message) setNotice({ tone: "ok", text: message });
      router.refresh();
      return true;
    }
    if (result.error.code === "VERSION_CONFLICT") {
      setNotice({
        tone: "conflict",
        text: `This session was changed somewhere else (now version ${result.error.serverVersion ?? "newer"}). Load the latest version, then make your change again.`,
      });
    } else if (result.error.code === "NOT_FOUND") {
      setNotice({ tone: "error", text: "This session no longer exists. It may have been deleted elsewhere." });
    } else {
      setNotice({ tone: "error", text: result.error.message });
    }
    return false;
  };

  const loadLatest = () => {
    setNotice(null);
    router.refresh();
  };

  return { pending, notice, setNotice, run, loadLatest };
}
