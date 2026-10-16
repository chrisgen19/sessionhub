import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentSession } from "@/server/session";

export const metadata: Metadata = { title: "Confirm email · SessionHub" };

// Better Auth's emailed link (/api/auth/verify-email) redirects here, with ?error=… on failure.
export default async function EmailVerifiedPage(props: PageProps<"/email-verified">) {
  const { error } = await props.searchParams;
  const signedIn = Boolean(await getCurrentSession());
  const link = "inline-flex h-10 w-full items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover";
  if (error !== undefined) {
    return (
      <>
        <h1 className="text-xl font-bold tracking-tight">This link doesn&apos;t work anymore</h1>
        <p className="mt-2 mb-5 text-[13px] text-fg-muted">
          Confirmation links work for 24 hours. {signedIn ? "Send yourself a new one from Settings." : "Sign in, then send yourself a new one from Settings."}
        </p>
        <Link href={signedIn ? "/app/settings" : "/login?next=%2Fapp%2Fsettings"} className={link}>
          {signedIn ? "Go to Settings" : "Sign in"}
        </Link>
      </>
    );
  }
  return (
    <>
      <h1 className="text-xl font-bold tracking-tight">Email confirmed</h1>
      <p className="mt-2 mb-5 text-[13px] text-fg-muted">Thanks. Your account&apos;s email address is confirmed.</p>
      <Link href={signedIn ? "/app" : "/login"} className={link}>
        {signedIn ? "Go to your dashboard" : "Sign in"}
      </Link>
    </>
  );
}
