import { CheckCircle2, ExternalLink, LoaderCircle, Link2, Unlink } from "lucide-react";
import type { ReactNode } from "react";
import { buttonClass } from "../../components/modal";
import { useAccount } from "../../hooks/use-account";
import { useSessions } from "../../hooks/use-sessions";
import { API_ORIGIN } from "../../lib/api-config";
import type { AccountStatus } from "../../lib/account-service";
import { SyncSection } from "./sync-section";

const NOTICE_TEXT = {
  revoked: "This browser was disconnected from your account, from the website or because its sign-in was used somewhere else. Your saved sessions are still here.",
  expired: "This browser's sign-in expired. Connect again to keep using your account. Your saved sessions are still here.",
} as const;

function Card({ children }: { children: ReactNode }) {
  return <section className="max-w-xl space-y-4 rounded-xl border border-line bg-surface p-5">{children}</section>;
}

function Disconnected({ status, busy, onConnect }: { status: Extract<AccountStatus, { kind: "disconnected" }>; busy: boolean; onConnect: () => void }) {
  return (
    <Card>
      {status.notice && (
        <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-fg">
          {NOTICE_TEXT[status.notice]}
        </p>
      )}
      <h2 className="text-base font-semibold">Connect this browser to your account</h2>
      <p className="text-[13px] leading-relaxed text-fg-muted">
        SessionHub works fully without an account. Connecting is the first step towards syncing saved sessions between your
        computers. Connecting sends only this browser&apos;s name (for example &quot;Chrome on Windows&quot;) and a random installation
        ID to <span className="font-semibold text-fg">{new URL(API_ORIGIN).host}</span>. It doesn&apos;t upload any sessions: you choose
        that separately when you turn on sync.
      </p>
      <button type="button" className={buttonClass.primary} disabled={busy} onClick={onConnect}>
        {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Link2 aria-hidden="true" className="size-4" />}
        Connect account
      </button>
    </Card>
  );
}

function Pairing({ status, busy, onCancel }: { status: Extract<AccountStatus, { kind: "pairing" }>; busy: boolean; onCancel: () => void }) {
  return (
    <Card>
      <h2 className="text-base font-semibold">Approve on the website</h2>
      <p className="text-[13px] leading-relaxed text-fg-muted">
        We opened SessionHub in a new tab. Sign in if asked, check that it shows this code, then choose Connect this browser.
      </p>
      <p aria-label="Connection code" className="font-mono text-3xl font-bold tracking-[0.2em]">
        {status.userCode}
      </p>
      <p role="status" className="flex items-center gap-2 text-[13px] text-fg-muted">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Waiting for approval. The code works until{" "}
        {new Date(status.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href={status.verificationUriComplete} target="_blank" rel="noreferrer" className={buttonClass.secondary}>
          <ExternalLink aria-hidden="true" className="size-4" /> Open the page again
        </a>
        <button type="button" className={buttonClass.secondary} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Card>
  );
}

function Connected({ status, busy, onDisconnect }: { status: Extract<AccountStatus, { kind: "connected" }>; busy: boolean; onDisconnect: () => void }) {
  return (
    <Card>
      <p className="flex items-center gap-2 text-sm font-semibold">
        <CheckCircle2 aria-hidden="true" className="size-4 text-brand" /> Connected
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        <dt className="text-fg-muted">Account</dt>
        <dd className="min-w-0 truncate font-medium">
          {status.account.name} ({status.account.email})
        </dd>
        <dt className="text-fg-muted">This browser</dt>
        <dd className="min-w-0 truncate font-medium">{status.deviceName}</dd>
        <dt className="text-fg-muted">Server</dt>
        <dd className="min-w-0 truncate font-medium">{new URL(status.apiOrigin).host}</dd>
      </dl>
      <p className="text-xs leading-relaxed text-fg-muted">
        Disconnecting signs this browser out of your account. Sessions saved only in this browser stay here; your account&apos;s sessions
        stay in your account and show up again when you connect.
      </p>
      <button type="button" className={buttonClass.ghostDanger} disabled={busy} onClick={onDisconnect}>
        <Unlink aria-hidden="true" className="size-4" /> Disconnect
      </button>
    </Card>
  );
}

/** Manager view for connecting this browser to a SessionHub account (pairing). */
export function AccountView() {
  const { data, busy, message, run } = useAccount();
  const { state } = useSessions();
  const localSessions = state.status === "ready" ? state.sessions.filter((session) => state.syncLabels[session.id] === "local") : [];
  return (
    <main className="min-w-0 space-y-5 px-4 py-6 lg:px-8 lg:py-8">
      <h1 className="text-2xl font-bold tracking-tight">Account</h1>
      <div aria-live="polite">{message && <p className={`text-[13px] ${message.tone === "ok" ? "text-brand" : "text-danger"}`}>{message.text}</p>}</div>
      {data.status === "loading" && <div aria-busy="true" aria-label="Loading account" className="h-32 max-w-xl animate-pulse rounded-xl bg-surface-muted" />}
      {data.status === "error" && (
        <p role="alert" className="max-w-xl rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
          Account details unavailable: {data.message}. Your saved sessions aren&apos;t affected.
        </p>
      )}
      {data.status === "ready" && data.account.kind === "disconnected" && (
        <Disconnected status={data.account} busy={busy === "connect"} onConnect={() => void run("connect")} />
      )}
      {data.status === "ready" && data.account.kind === "pairing" && <Pairing status={data.account} busy={busy === "cancel"} onCancel={() => void run("cancel")} />}
      {data.status === "ready" && data.account.kind === "connected" && (
        <>
          <Connected status={data.account} busy={busy === "disconnect"} onDisconnect={() => void run("disconnect")} />
          <SyncSection localSessions={localSessions} />
        </>
      )}
    </main>
  );
}
