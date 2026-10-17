import { z } from "zod";
import { parseAddress, type MailAddress } from "./mail/types";

/** Hosts a production build may serve over plain http: the machine itself (local Docker runs, E2E). */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Production must be served over HTTPS: it also makes Better Auth's cookies `Secure` (docs/DEPLOYMENT.md). */
const isAllowedOrigin = (value: string): boolean => process.env.NODE_ENV !== "production" || value.startsWith("https://") || LOOPBACK_HOSTS.has(new URL(value).hostname);

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z
    .url("BETTER_AUTH_URL must be the app's public origin, e.g. http://localhost:3000")
    .refine(isAllowedOrigin, "BETTER_AUTH_URL must use https in production (plain http only for localhost)"),
  /** Reverse proxies in front of the app that append to X-Forwarded-For (see client-ip.ts). */
  TRUSTED_PROXY_COUNT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int("TRUSTED_PROXY_COUNT must be a whole number").min(1, "TRUSTED_PROXY_COUNT must be 1 to 5").max(5, "TRUSTED_PROXY_COUNT must be 1 to 5").default(1),
  ),
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

/**
 * Why this server can't work as configured, or null. Names variables and rules only, never values
 * (the messages above don't echo them). /api/health reports it so a misconfigured deploy never
 * turns healthy.
 */
export const configurationProblem = (): string | null => {
  try {
    getServerEnv();
    getMailConfig();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid configuration";
  }
};
