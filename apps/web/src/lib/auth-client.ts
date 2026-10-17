import { createAuthClient } from "better-auth/react";

/**
 * Browser client for Better Auth's HTTP endpoints (/api/auth/*). Sign-in and sign-up go
 * through these endpoints, not server actions, so Better Auth's rate limiting and origin
 * checks always apply (direct `auth.api` calls from server code skip the rate limiter).
 */
export const authClient = createAuthClient();
