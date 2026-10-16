import { z } from "zod";

/** Password limits shared by the forms and the Better Auth config (src/server/auth.ts). */
export const PASSWORD_LIMITS = { min: 10, max: 128 } as const;

const email = z.email("Enter a valid email address").max(254);
const password = z
  .string()
  .min(PASSWORD_LIMITS.min, `Use at least ${PASSWORD_LIMITS.min} characters`)
  .max(PASSWORD_LIMITS.max, `Use at most ${PASSWORD_LIMITS.max} characters`);

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  email,
  password,
});

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password").max(PASSWORD_LIMITS.max),
});

export const forgotPasswordSchema = z.object({ email });

const confirmMatches = (value: { password: string; confirmPassword: string }, context: z.RefinementCtx) => {
  if (value.password !== value.confirmPassword) {
    context.addIssue({ code: "custom", path: ["confirmPassword"], message: "The passwords don't match" });
  }
};

export const resetPasswordSchema = z.object({ password, confirmPassword: z.string() }).superRefine(confirmMatches);

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, "Enter your current password").max(PASSWORD_LIMITS.max), password, confirmPassword: z.string() })
  .superRefine(confirmMatches);

const FIELDS = ["name", "email", "password", "currentPassword", "confirmPassword"] as const;
type Field = (typeof FIELDS)[number];

export type FieldErrors = Partial<Record<Field | "form", string>>;

const isField = (key: unknown): key is Field => FIELDS.includes(key as Field);

/** First error per field, for inline messages. */
export const fieldErrors = (error: z.ZodError): FieldErrors => {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (isField(key) && !result[key]) result[key] = issue.message;
  }
  return result;
};

/**
 * Only same-site relative paths are allowed as post-login destinations, so a crafted
 * `?next=` link can't send someone to another site after they sign in.
 */
export const safeNextPath = (value: unknown, fallback = "/app"): string => {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const url = new URL(value, "http://localhost");
    return url.origin === "http://localhost" ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
};
