"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { changePasswordSchema, PASSWORD_LIMITS } from "@/lib/auth-validation";
import { FormError, FormNotice, TextField } from "./text-field";
import { useAuthForm } from "./use-auth-form";

/** Signed-in password change. Other browsers are signed out; this one stays signed in. */
export function ChangePasswordForm() {
  const [done, setDone] = useState(false);
  const { errors, pending, onSubmit } = useAuthForm(
    changePasswordSchema,
    (input) => {
      setDone(false);
      return authClient.changePassword({ currentPassword: input.currentPassword, newPassword: input.password, revokeOtherSessions: true });
    },
    (form) => {
      form.reset();
      setDone(true);
    },
  );
  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-3" aria-label="Change password">
      <FormError message={errors.form} />
      <FormNotice message={done ? "Password changed. Other browsers signed in to this account were signed out." : undefined} />
      <TextField label="Current password" name="currentPassword" type="password" autoComplete="current-password" required error={errors.currentPassword} />
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
      <TextField label="Confirm new password" name="confirmPassword" type="password" autoComplete="new-password" required error={errors.confirmPassword} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-9 items-center rounded-lg bg-brand px-3.5 text-[13px] font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
      >
        {pending ? "Please wait…" : "Change password"}
      </button>
    </form>
  );
}
