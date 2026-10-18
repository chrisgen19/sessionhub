import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { FormNotice } from "@/components/auth/text-field";
import { safeNextPath } from "@/lib/auth-validation";
import { getCurrentSession } from "@/server/session";

export const metadata: Metadata = { title: "Sign in · SessionHub" };

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const next = safeNextPath(searchParams.next);
  if (await getCurrentSession()) redirect(next);
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-1 mb-6 text-[13px] text-fg-muted">Welcome back.</p>
      {searchParams.reset === "1" && (
        <div className="mb-4">
          <FormNotice message="Password changed, and every browser that was signed in has been signed out. Sign in with your new password." />
        </div>
      )}
      <SignInForm next={next} />
    </>
  );
}
