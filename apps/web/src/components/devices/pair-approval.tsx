"use client";

import type { ApiDevice } from "@sessionhub/contracts/api-devices";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "approved" } | { kind: "denied" } | { kind: "error"; message: string };

const ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: "This request expired or was already answered. Start again from the extension.",
  EMAIL_NOT_CONFIRMED: "Confirm your email first. Use the link we sent you, then try again.",
  RATE_LIMITED: "Too many attempts. Wait a moment and try again.",
};

/** Approve or decline one pending connection request. Nothing is uploaded by approving. */
export function PairApproval({ userCode }: { userCode: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const decide = async (decision: "approve" | "deny") => {
    setState({ kind: "busy" });
    const result = await apiFetch<{ status: "approved"; device: ApiDevice } | { status: "denied" }>("/api/v1/pairing/decision", "POST", { userCode, decision });
    if (result.ok) setState({ kind: result.data.status });
    else setState({ kind: "error", message: ERROR_MESSAGES[result.error.code] ?? result.error.message });
  };

  if (state.kind === "approved") {
    return (
      <p role="status" className="rounded-lg bg-brand-soft px-3 py-2.5 text-[13px] text-fg">
        <span className="font-semibold">Connected.</span> Go back to the extension: it finishes on its own within a few seconds. You can
        disconnect this browser any time from Devices.
      </p>
    );
  }
  if (state.kind === "denied") {
    return (
      <p role="status" className="rounded-lg bg-surface-muted px-3 py-2.5 text-[13px] text-fg">
        Declined. That browser wasn&apos;t connected to your account.
      </p>
    );
  }
  const busy = state.kind === "busy";
  return (
    <div className="space-y-3">
      {state.kind === "error" && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {state.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide("approve")}
          className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
        >
          Connect this browser
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide("deny")}
          className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm font-semibold hover:bg-surface-muted disabled:opacity-60"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
