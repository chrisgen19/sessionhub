import { z } from "zod";
import { parseAddress, type MailAddress } from "./mail/types";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url("BETTER_AUTH_URL must be the app's public origin, e.g. http://localhost:3000"),
});
export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/**
 * Validated server-only configuration. Read lazily (not at import time) so `next build`
 * can analyse route modules without secrets present.
 */
export const getServerEnv = (): ServerEnv => {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid server environment: ${problems}`);
  }
  cached = parsed.data;
  return cached;
};

const optional = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());

const mailEnvSchema = z
  .object({
    MAIL_TRANSPORT: z.preprocess((value) => (value === "" ? undefined : value), z.enum(["disabled", "mailpit", "resend"]).default("disabled")),
    MAIL_FROM: optional,
    RESEND_API_KEY: optional,
    MAILPIT_URL: z.preprocess((value) => (value === "" ? undefined : value), z.url().default("http://127.0.0.1:8025")),
  })
  .superRefine((env, context) => {
    if (env.MAIL_TRANSPORT !== "disabled" && !env.MAIL_FROM?.includes("@")) {
      context.addIssue({ code: "custom", path: ["MAIL_FROM"], message: "MAIL_FROM must be an address like `SessionHub <no-reply@example.com>`" });
    }
    if (env.MAIL_TRANSPORT === "resend" && !env.RESEND_API_KEY) {
      context.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "RESEND_API_KEY is required when MAIL_TRANSPORT=resend" });
    }
  });

export type MailConfig =
  | { transport: "disabled" }
  | { transport: "mailpit"; from: MailAddress; mailpitUrl: string }
  | { transport: "resend"; from: MailAddress; resendApiKey: string };

let cachedMail: MailConfig | undefined;

/** Validated email settings (MAIL_TRANSPORT defaults to `disabled`). Read lazily like getServerEnv. */
export const getMailConfig = (): MailConfig => {
  if (cachedMail) return cachedMail;
  const parsed = mailEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid email configuration: ${problems}`);
  }
  const { MAIL_TRANSPORT, MAIL_FROM = "", RESEND_API_KEY = "", MAILPIT_URL } = parsed.data;
  if (MAIL_TRANSPORT === "disabled") cachedMail = { transport: "disabled" };
  else if (MAIL_TRANSPORT === "mailpit") cachedMail = { transport: "mailpit", from: parseAddress(MAIL_FROM), mailpitUrl: MAILPIT_URL };
  else cachedMail = { transport: "resend", from: parseAddress(MAIL_FROM), resendApiKey: RESEND_API_KEY };
  return cachedMail;
};
