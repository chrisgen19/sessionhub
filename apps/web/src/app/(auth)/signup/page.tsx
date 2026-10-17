import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { safeNextPath } from "@/lib/auth-validation";
import { getCurrentSession } from "@/server/session";

export const metadata: Metadata = { title: "Create account · SessionHub" };

export default async function SignUpPage(props: PageProps<"/signup">) {
  const next = safeNextPath((await props.searchParams).next);
  if (await getCurrentSession()) redirect(next);
  return (
    <>
      <h1 className="text-xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-1 mb-6 text-[13px] text-fg-muted">Use it later to sync saved sessions between your computers.</p>
      <SignUpForm next={next} />
    </>
  );
}
