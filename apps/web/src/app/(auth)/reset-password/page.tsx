import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password · SessionHub" };

// Better Auth's emailed link (/api/auth/reset-password/:token) checks the token, then
// redirects here with ?token=… or, when it's expired or used, ?error=INVALID_TOKEN.
export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const { token, error } = await props.searchParams;
  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(token) && error === undefined;
  if (!valid) {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight">This link doesn&apos;t work anymore</h1>
        <p className="mt-2 mb-5 text-[13px] text-fg-muted">
          Reset links work for 1 hour and only once. Your password hasn&apos;t changed. Ask for a new link to try again.
        </p>
        <Link
          href="/forgot-password"
          className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover"
        >
          Send a new link
        </Link>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
      <p className="mt-1 mb-6 text-[13px] text-fg-muted">Use one you don&apos;t use anywhere else.</p>
      <ResetPasswordForm token={token} />
    </>
  );
}
