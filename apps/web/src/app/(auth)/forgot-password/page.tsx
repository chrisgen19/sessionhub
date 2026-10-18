import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { isMailEnabled } from "@/server/mail/deliver";

export const metadata: Metadata = { title: "Reset password · SessionHub" };

export default async function ForgotPasswordPage() {
  // Email settings are read at request time, never baked in at build time.
  await connection();
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
      {isMailEnabled() ? (
        <>
          <p className="mt-1 mb-6 text-[13px] text-fg-muted">Enter your account&apos;s email and we&apos;ll send you a link to choose a new password.</p>
          <ForgotPasswordForm />
        </>
      ) : (
        <div className="mt-3 space-y-4 text-[13px] text-fg-muted">
          <p>This server isn&apos;t set up to send email, so passwords can&apos;t be reset by email. Contact whoever runs it.</p>
          <Link href="/login" className="font-semibold text-brand hover:underline">
            Back to sign in
          </Link>
        </div>
      )}
    </>
  );
}
