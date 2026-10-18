import type { Metadata } from "next";
import Link from "next/link";
import { isMailEnabled } from "@/server/mail/deliver";
import { getCurrentSession } from "@/server/session";

export const metadata: Metadata = { title: "Confirm email · SessionHub" };

// Better Auth's emailed link (/api/auth/verify-email) redirects here, with ?error=… on failure and
// no query on success. A bare URL proves nothing, so signed-in visitors see their account's status.
export default async function EmailVerifiedPage(props: PageProps<"/email-verified">) {
  const { error } = await props.searchParams;
  const session = await getCurrentSession();
  const signedIn = Boolean(session);
  const link = "inline-flex h-10 w-full items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover";
  if (error !== undefined) {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight">This link doesn&apos;t work anymore</h1>
        <p className="mt-2 mb-5 text-[13px] text-fg-muted">
          Confirmation links work for 24 hours. {signedIn ? "Send yourself a new one from Settings." : "Sign in, then send yourself a new one from Settings."}
        </p>
        <Link href={signedIn ? "/app/settings" : "/login?next=%2Fapp%2Fsettings"} className={link}>
          {signedIn ? "Go to Settings" : "Sign in"}
        </Link>
      </>
    );
  }
  if (session && !session.user.emailVerified) {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight">Your email isn&apos;t confirmed yet</h1>
        <p className="mt-2 mb-5 text-[13px] break-words text-fg-muted">
          {session.user.email} hasn&apos;t been confirmed.
          {isMailEnabled() && " Open the link we emailed you, or send yourself a new one from Settings."}
        </p>
        <Link href="/app/settings" className={link}>
          Go to Settings
        </Link>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Email confirmed</h1>
      <p className="mt-2 mb-5 text-[13px] text-fg-muted">Thanks. Your account&apos;s email address is confirmed.</p>
      <Link href={signedIn ? "/app" : "/login"} className={link}>
        {signedIn ? "Go to your dashboard" : "Sign in"}
      </Link>
    </>
  );
}
