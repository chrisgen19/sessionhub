"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { signInSchema } from "@/lib/auth-validation";
import { FormError, SubmitButton, TextField } from "./text-field";
import { useAuthForm } from "./use-auth-form";

export function SignInForm({ next }: { next: string }) {
  const { errors, pending, onSubmit } = useAuthForm(signInSchema, (input) => authClient.signIn.email(input), next);
  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
      <FormError message={errors.form} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required error={errors.email} />
      <TextField label="Password" name="password" type="password" autoComplete="current-password" required error={errors.password} />
      <p className="-mt-2 text-right text-[13px]">
        <Link href="/forgot-password" className="font-semibold text-brand hover:underline">
          Forgot password?
        </Link>
      </p>
      <SubmitButton pending={pending}>Sign in</SubmitButton>
      <p className="text-center text-[13px] text-fg-muted">
        New to SessionHub?{" "}
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold text-brand hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
