import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { safeNextPath } from "@/lib/auth-validation";
import { getCurrentSession } from "@/server/session";

export const metadata: Metadata = { title: "Sign in · SessionHub" };

export default async function LoginPage(props: PageProps<"/login">) {
  const next = safeNextPath((await props.searchParams).next);
  if (await getCurrentSession()) redirect(next);
  return (
    <>
      <h1 className="text-xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-1 mb-6 text-[13px] text-fg-muted">Welcome back.</p>
      <SignInForm next={next} />
    </>
  );
}
