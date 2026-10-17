import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";
import { clientAddress } from "@/server/client-ip";
import { observeRequest, readBodyText } from "@/server/observability/request";

// Better Auth's endpoints (/api/auth/*). Resolved per request so builds need no secrets.
const handlers = () => toNextJsHandler(getAuth());

/** Auth bodies are small forms (credentials, an email address); anything bigger is refused unread. */
const AUTH_BODY_MAX = 64 * 1024;

const tooLarge = () => Response.json({ code: "PAYLOAD_TOO_LARGE", message: "The request body is too large." }, { status: 413, headers: { "cache-control": "no-store" } });

/**
 * Better Auth reads X-Forwarded-For itself (rate limits, session records): it gets only the one
 * address our trusted-proxy rule resolved, never the client-controlled part of the chain.
 */
const trustedHeaders = (request: Request): Headers => {
  const headers = new Headers(request.headers);
  const address = clientAddress(request.headers);
  if (address) headers.set("x-forwarded-for", address);
  else headers.delete("x-forwarded-for");
  return headers;
};

// A fresh Request from the URL: `new Request(request, ...)` fails the private-field check on the
// request object Next passes to route handlers.
export const GET = (request: Request) => observeRequest(request, () => handlers().GET(new Request(request.url, { headers: trustedHeaders(request) })));

/** Reads the body with a hard cap, then hands Better Auth a request carrying exactly that body. */
export const POST = (request: Request) =>
  observeRequest(request, async () => {
    const body = await readBodyText(request, AUTH_BODY_MAX);
    if (body === null) return tooLarge();
    const headers = trustedHeaders(request);
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    return handlers().POST(new Request(request.url, { method: "POST", headers, body }));
  });
