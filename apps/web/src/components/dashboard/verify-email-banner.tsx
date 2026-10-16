import { MailWarning } from "lucide-react";
import { ResendVerificationButton } from "@/components/auth/resend-verification-button";

/** Shown on every /app page until the account's email is confirmed (only when email delivery is set up). */
export function VerifyEmailBanner({ email }: { email: string }) {
  return (
    <div role="region" aria-label="Confirm your email" className="mb-6 flex items-start gap-3 rounded-xl border border-line bg-warning-soft p-4 text-[13px]">
      <MailWarning aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
      <p className="min-w-0 leading-relaxed break-words text-fg-muted">
        <span className="font-semibold text-fg">Confirm your email.</span> We sent a link to {email}. You&apos;ll need a confirmed email
        before turning on cloud sync. <ResendVerificationButton email={email} />
      </p>
    </div>
  );
}
