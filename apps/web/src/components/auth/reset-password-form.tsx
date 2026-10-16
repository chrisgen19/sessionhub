"use client";

import { authClient } from "@/lib/auth-client";
import { PASSWORD_LIMITS, resetPasswordSchema } from "@/lib/auth-validation";
import { FormError, SubmitButton, TextField } from "./text-field";
import { useAuthForm } from "./use-auth-form";

export function ResetPasswordForm({ token }: { token: string }) {
  const { errors, pending, onSubmit } = useAuthForm(
    resetPasswordSchema,
    (input) => authClient.resetPassword({ newPassword: input.password, token }),
    "/login?reset=1",
  );
  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
      <FormError message={errors.form} />
      <TextField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_LIMITS.min}
        maxLength={PASSWORD_LIMITS.max}
        hint={`At least ${PASSWORD_LIMITS.min} characters.`}
        error={errors.password}
      />
      <TextField
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        error={errors.confirmPassword}
      />
      <SubmitButton pending={pending}>Change password</SubmitButton>
      <p className="text-center text-xs text-fg-muted">Every browser signed in to this account will be signed out.</p>
    </form>
  );
}
