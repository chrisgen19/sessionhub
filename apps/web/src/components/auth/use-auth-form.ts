"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { z } from "zod";
import { authErrorMessage, type AuthErrorLike } from "@/lib/auth-errors";
import { fieldErrors, type FieldErrors } from "@/lib/auth-validation";

/**
 * Shared submit flow: validate with the shared Zod schema, call a Better Auth client
 * method, then navigate to `next` (already sanitised server-side) and refresh server data.
 */
export function useAuthForm<T extends z.ZodType>(
  schema: T,
  submit: (input: z.infer<T>) => Promise<{ error: AuthErrorLike | null }>,
  next: string,
) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = schema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
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
    router.replace(next);
    router.refresh();
  };

  return { errors, pending, onSubmit };
}
