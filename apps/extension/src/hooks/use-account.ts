import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountStatus, PairingOutcome } from "../lib/account-service";
import { sendCommand } from "../lib/message-client";

export type AccountData = { status: "loading" } | { status: "ready"; account: AccountStatus } | { status: "error"; message: string };

type Action = "connect" | "cancel" | "disconnect";

/**
 * Account status from the background worker. While a pairing is pending, this page polls
 * at the server's interval (MV3 alarms can't fire that often); closing the page pauses it,
 * and reopening within 10 minutes resumes.
 */
export function useAccount() {
  const [data, setData] = useState<AccountData>({ status: "loading" });
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const checked = useRef(false);

  const apply = (response: Awaited<ReturnType<typeof sendCommand>>, okText?: string) => {
    if (response.ok) {
      setData({ status: "ready", account: response.data as AccountStatus });
      if (okText) setMessage({ tone: "ok", text: okText });
    } else {
      setMessage({ tone: "error", text: response.error.message });
    }
  };

  useEffect(() => {
    void sendCommand({ type: "account.status" }).then((response) => {
      if (!response.ok) setData({ status: "error", message: response.error.message });
      else setData({ status: "ready", account: response.data });
    });
  }, []);

  // Once per page load, confirm a stored connection with the server (detects revocation).
  const kind = data.status === "ready" ? data.account.kind : null;
  useEffect(() => {
    if (kind !== "connected" || checked.current) return;
    checked.current = true;
    void sendCommand({ type: "account.check" }).then((response) => {
      if (response.ok) setData({ status: "ready", account: response.data });
    });
  }, [kind]);

  const interval = data.status === "ready" && data.account.kind === "pairing" ? data.account.interval : null;
  useEffect(() => {
    if (!interval) return;
    const OUTCOME_TEXT: Partial<Record<PairingOutcome, { tone: "ok" | "error"; text: string }>> = {
      connected: { tone: "ok", text: "Connected. This browser can now use your SessionHub account." },
      denied: { tone: "error", text: "The connection was declined on the website. Nothing was connected." },
      expired: { tone: "error", text: "The code expired before it was approved. Start again when you're ready." },
    };
    const timer = window.setInterval(() => {
      void sendCommand({ type: "account.poll" }).then((response) => {
        if (!response.ok) return;
        setData({ status: "ready", account: response.data.status });
        const text = OUTCOME_TEXT[response.data.outcome];
        if (text) setMessage(text);
      });
    }, interval * 1000);
    return () => window.clearInterval(timer);
  }, [interval]);

  const run = useCallback(async (action: Action) => {
    setBusy(action);
    setMessage(null);
    const type = action === "connect" ? "account.connect" : action === "cancel" ? "account.cancel" : "account.disconnect";
    apply(await sendCommand({ type }), action === "disconnect" ? "Disconnected. Sessions saved only in this browser are still here; your account's sessions come back when you connect again." : undefined);
    setBusy(null);
  }, []);

  return { data, busy, message, run };
}
