import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { getPrisma } from "@sessionhub/database/client";
import { PASSWORD_LIMITS } from "@/lib/auth-validation";
import { getServerEnv } from "./env";

export const NAME_MAX_LENGTH = 120;

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
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_LIMITS.min,
      maxPasswordLength: PASSWORD_LIMITS.max,
      autoSignIn: true,
      // No email delivery yet (M3 backlog). Turn on together with verification emails.
      requireEmailVerification: false,
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
