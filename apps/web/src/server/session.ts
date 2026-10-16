import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "./auth";

/** The signed-in Better Auth session for this request, or null. Deduplicated per render. */
export const getCurrentSession = cache(async () => {
  // Read request headers first: it marks the route dynamic before any auth code runs,
  // so `next build` never tries to initialise auth (or need its secrets).
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

export type CurrentSession = NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;

/**
 * Full session check for signed-in pages. The proxy only checks that a cookie exists;
 * this validates it against the database. Redirects to sign-in when it isn't valid.
 */
export const requireSession = async (next = "/app"): Promise<CurrentSession> => {
  const session = await getCurrentSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(next)}`);
  return session;
};
