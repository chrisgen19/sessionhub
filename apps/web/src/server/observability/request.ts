import { log, requestIdFor, withRequestId } from "./logger";
import { redactPath } from "./redact";

/** Sets a header even on a response whose headers are immutable (e.g. Response.redirect). */
const withHeader = (response: Response, name: string, value: string): Response => {
  try {
    response.headers.set(name, value);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};

/**
 * Runs one API request with a request id: logs inside it carry the id, the response returns it
 * (`X-Request-Id`), and one access line records method, redacted path, status and duration. Never
 * the query, body, IP address or user.
 */
export const observeRequest = async (request: Request, handler: () => Promise<Response>): Promise<Response> => {
  const requestId = requestIdFor(request);
  const started = performance.now();
  return withRequestId(requestId, async () => {
    const response = withHeader(await handler(), "x-request-id", requestId);
    log(response.status >= 500 ? "error" : "info", "http_request", {
      method: request.method,
      path: redactPath(request.url),
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    });
    return response;
  });
};

/**
 * Reads a request body up to `max` bytes, stopping as soon as it passes the limit, so a request
 * without (or with a false) Content-Length can't stream an unbounded body into memory. Null when
 * the body is too large.
 */
export const readBodyText = async (request: Request, max: number): Promise<string | null> => {
  if (Number(request.headers.get("content-length") ?? "0") > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
};
