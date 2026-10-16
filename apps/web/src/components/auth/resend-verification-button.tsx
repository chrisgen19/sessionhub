"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

type State = { kind: "idle" } | { kind: "pending" } | { kind: "sent" } | { kind: "error"; message: string };

/** Sends a new confirmation link to the signed-in user's own address. */
export function ResendVerificationButton({ email }: { email: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const resend = async () => {
    setState({ kind: "pending" });
    try {
      const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/email-verified" });
      setState(error ? { kind: "error", message: authErrorMessage(error) } : { kind: "sent" });
    } catch {
      setState({ kind: "error", message: authErrorMessage(null) });
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <button
        type="button"
        onClick={() => void resend()}
        disabled={state.kind === "pending"}
        className="font-semibold text-brand hover:underline disabled:opacity-60"
      >
        {state.kind === "pending" ? "Sending…" : state.kind === "sent" ? "Send again" : "Resend link"}
      </button>
      <span role="status" className="text-fg-muted">
        {state.kind === "sent" ? `Sent. Check ${email}.` : null}
      </span>
      {state.kind === "error" && (
        <span role="alert" className="text-danger">
          {state.message}
        </span>
      )}
    </span>
  );
}
