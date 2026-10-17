"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { z } from "zod";
import { authErrorMessage, type AuthErrorLike } from "@/lib/auth-errors";
import { fieldErrors, type FieldErrors } from "@/lib/auth-validation";

/**
 * Shared submit flow: validate with the shared Zod schema, call a Better Auth client
 * method, then either navigate to a path (already sanitised server-side) and refresh
 * server data, or run `onSuccess` with the submitted form.
 */
export function useAuthForm<T extends z.ZodType>(
  schema: T,
  submit: (input: z.infer<T>) => Promise<{ error: AuthErrorLike | null }>,
  onSuccess: string | ((form: HTMLFormElement) => void),
) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = schema.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const { error } = await submit(parsed.data);
      if (error) {
        setErrors({ form: authErrorMessage(error) });
        setPending(false);
        return;
      }
    } catch {
      setErrors({ form: authErrorMessage(null) });
      setPending(false);
      return;
    }
    if (typeof onSuccess === "function") {
      setPending(false);
      onSuccess(form);
      return;
    }
    router.replace(onSuccess);
    router.refresh();
  };

  return { errors, pending, onSubmit };
}
