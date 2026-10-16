"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { forgotPasswordSchema } from "@/lib/auth-validation";
import { FormError, FormNotice, SubmitButton, TextField } from "./text-field";
import { useAuthForm } from "./use-auth-form";

/** The answer is the same whether or not an account exists, so it can't be used to probe emails. */
export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { errors, pending, onSubmit } = useAuthForm(
    forgotPasswordSchema,
    (input) => authClient.requestPasswordReset({ email: input.email, redirectTo: "/reset-password" }),
    (form) => setSentTo(String(new FormData(form).get("email") ?? "")),
  );
  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
      <FormError message={errors.form} />
      <FormNotice
        message={
          sentTo
            ? `If there's an account for ${sentTo}, we've sent it a link to choose a new password. The link works for 1 hour. Check your spam folder if it doesn't arrive.`
            : undefined
        }
      />
      <TextField label="Email" name="email" type="email" autoComplete="email" required error={errors.email} />
      <SubmitButton pending={pending}>{sentTo ? "Send another link" : "Send reset link"}</SubmitButton>
      <p className="text-center text-[13px] text-fg-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
