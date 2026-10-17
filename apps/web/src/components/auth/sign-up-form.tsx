"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { PASSWORD_LIMITS, signUpSchema } from "@/lib/auth-validation";
import { FormError, SubmitButton, TextField } from "./text-field";
import { useAuthForm } from "./use-auth-form";

export function SignUpForm({ next }: { next: string }) {
  const { errors, pending, onSubmit } = useAuthForm(signUpSchema, (input) => authClient.signUp.email(input), next);
  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
      <FormError message={errors.form} />
      <TextField label="Name" name="name" autoComplete="name" required maxLength={120} error={errors.name} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required error={errors.email} />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_LIMITS.min}
        maxLength={PASSWORD_LIMITS.max}
        hint={`At least ${PASSWORD_LIMITS.min} characters.`}
        error={errors.password}
      />
      <SubmitButton pending={pending}>Create account</SubmitButton>
      <p className="text-center text-[13px] text-fg-muted">
        Already have an account?{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
