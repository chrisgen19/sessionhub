import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate for /app: no session cookie -> sign-in, keeping the deep link in `next`.
 * It only checks that a cookie exists; every /app page still validates the session
 * against the database (requireSession), as the Next.js docs require.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/app", "/app/:path*"] };
