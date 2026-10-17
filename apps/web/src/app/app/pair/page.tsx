import { normalizeUserCode, PAIRING, userCodeSchema } from "@sessionhub/contracts/api-pairing";
import { getPrisma } from "@sessionhub/database/client";
import { MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";
import { ResendVerificationButton } from "@/components/auth/resend-verification-button";
import { PageHeader } from "@/components/dashboard/page-parts";
import { PairApproval } from "@/components/devices/pair-approval";
import { findPendingPairing } from "@/server/devices/pairing";
import { isMailEnabled } from "@/server/mail/deliver";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Connect a browser · SessionHub" };

function CodeForm({ value, error }: { value?: string; error?: string }) {
  return (
    <form method="get" className="max-w-sm space-y-3">
      <label htmlFor="code" className="block text-[13px] font-semibold">
        Code shown in the extension
      </label>
      <input
        id="code"
        name="code"
        defaultValue={value}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="XXXX-XXXX"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "code-error" : undefined}
        className="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-sm tracking-widest uppercase"
      />
      {error && (
        <p id="code-error" className="text-xs text-danger">
          {error}
        </p>
      )}
      <button type="submit" className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover">
        Continue
      </button>
    </form>
  );
}

export default async function PairPage(props: PageProps<"/app/pair">) {
  const raw = (await props.searchParams).code;
  const { user } = await requireSession(`/app/pair${typeof raw === "string" ? `?code=${encodeURIComponent(raw)}` : ""}`);
  const header = <PageHeader title="Connect a browser" description="Link the SessionHub extension on a computer to this account." />;
  if (typeof raw !== "string" || raw.trim() === "") return <>{header}<CodeForm /></>;

  const parsed = userCodeSchema.safeParse(raw);
  const pairing = parsed.success ? await findPendingPairing(getPrisma(), parsed.data) : null;
  if (!pairing) {
    return (
      <>
        {header}
        <CodeForm value={normalizeUserCode(raw).slice(0, 16)} error="No pending request with that code. Codes work for 10 minutes; start again from the extension if it expired." />
      </>
    );
  }
  const needsConfirmation = !user.emailVerified && isMailEnabled();
  return (
    <>
      {header}
      <section aria-label="Connection request" className="max-w-xl space-y-4 rounded-xl border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <MonitorSmartphone aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-fg-muted" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{pairing.deviceName}</p>
            <p className="text-xs text-fg-muted">{[pairing.browser, pairing.platform].filter(Boolean).join(" · ") || "Browser"}</p>
          </div>
        </div>
        <div>
          <p className="text-xs text-fg-muted">Code</p>
          <p className="font-mono text-2xl font-bold tracking-[0.2em]">{pairing.userCode}</p>
        </div>
        <p className="text-[13px] leading-relaxed text-fg-muted">
          Only continue if you just clicked <span className="font-semibold text-fg">Connect account</span> in the SessionHub extension
          and it shows this exact code. Connecting lets that browser use your account as <span className="font-semibold text-fg">{user.email}</span>.
          It doesn&apos;t upload anything yet: cloud sync stays off until you turn it on in the extension. This request expires in {PAIRING.expiresInSeconds / 60}{" "}
          minutes.
        </p>
        {needsConfirmation ? (
          <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-fg">
            <span className="font-semibold">Confirm your email first.</span> Open the link we sent to {user.email}, then reload this page.{" "}
            <ResendVerificationButton email={user.email} />
          </p>
        ) : (
          <PairApproval userCode={pairing.userCode} />
        )}
      </section>
    </>
  );
}
