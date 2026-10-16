import { headers } from "next/headers";
import { cache } from "react";
import { getAuth } from "./auth";

/** The signed-in Better Auth session for this request, or null. Deduplicated per render. */
export const getCurrentSession = cache(async () => {
  // Read request headers first: it marks the route dynamic before any auth code runs,
  // so `next build` never tries to initialise auth (or need its secrets).
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});
