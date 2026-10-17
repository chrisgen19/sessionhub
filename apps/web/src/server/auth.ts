import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { getPrisma } from "@sessionhub/database/client";
import { PASSWORD_LIMITS } from "@/lib/auth-validation";
import { authRateLimitStorage } from "./api/rate-limit";
import { getServerEnv } from "./env";
import { queueMail } from "./mail/deliver";
import { passwordChangedEmail, passwordResetEmail, verificationEmail } from "./mail/templates";

export const NAME_MAX_LENGTH = 120;
export const RESET_TOKEN_TTL_SECONDS = 60 * 60;
export const VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/**
 * Emailed links always land on our own pages, whatever callbackURL a client sent (or left
 * out): /email-verified for confirmations, /reset-password for resets.
 */
export const withCallback = (link: string, callbackPath: "/email-verified" | "/reset-password"): string => {
  const url = new URL(link);
  url.searchParams.set("callbackURL", callbackPath);
  return url.toString();
};

/** Server-side name rules (the HTTP endpoints accept any string): trimmed, 1 to 120 chars. */
const normalizeName = (name: unknown): string => {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length === 0 || trimmed.length > NAME_MAX_LENGTH) {
    throw new APIError("BAD_REQUEST", { code: "INVALID_NAME", message: "Name must be 1 to 120 characters" });
  }
  return trimmed;
};

const createAuth = () => {
  const env = getServerEnv();
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: prismaAdapter(getPrisma(), { provider: "postgresql", transaction: true }),
    // Better Auth's own limits (sign-in, reset, ...) in the shared buckets, so they hold across instances.
    rateLimit: { customStorage: authRateLimitStorage(getPrisma) },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_LIMITS.min,
      maxPasswordLength: PASSWORD_LIMITS.max,
      autoSignIn: true,
      // Accounts are optional and the extension works without one, so an unverified email
      // doesn't block sign-in. Cloud sync and device pairing (M4) will require a verified email.
      requireEmailVerification: false,
      // Emails are queued, never awaited (see queueMail): same response time for every address.
      sendResetPassword: async ({ user, url }) => queueMail(passwordResetEmail(user.email, user.name, withCallback(url, "/reset-password"))),
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => queueMail(passwordChangedEmail(user.email, user.name)),
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) =>
        queueMail(verificationEmail(user.email, user.name, withCallback(url, "/email-verified"))),
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: VERIFICATION_TOKEN_TTL_SECONDS,
    },
    databaseHooks: {
      user: {
        create: { before: async (user) => ({ data: { ...user, name: normalizeName(user.name) } }) },
        update: {
          before: async (user) => (user.name === undefined ? undefined : { data: { ...user, name: normalizeName(user.name) } }),
        },
      },
    },
    // Must stay last: lets server actions set Better Auth's session cookies.
    plugins: [nextCookies()],
  });
};

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** Server-only Better Auth instance, created on first use. */
export const getAuth = (): Auth => {
  instance ??= createAuth();
  return instance;
};
