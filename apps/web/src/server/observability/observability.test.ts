import { afterEach, describe, expect, it } from "vitest";
import { handle, HttpError, json } from "../api/http";
import { captureLogs, log } from "./logger";
import { redactFields, redactPath, redactText } from "./redact";
import { observeRequest, readBodyText } from "./request";

let restore: (() => void) | null = null;
const lines: { level: string; entry: Record<string, unknown> }[] = [];
const capture = () => {
  lines.length = 0;
  restore = captureLogs((level, line) => lines.push({ level, entry: JSON.parse(line) as Record<string, unknown> }));
};
afterEach(() => {
  restore?.();
  restore = null;
});

const SESSION = "64b7e32a-11f4-4caa-929f-0fab1139a7b0";

describe("redaction", () => {
  it("removes URLs, emails and tokens from any text", () => {
    const text = `failed for pat@example.test opening https://bank.test/a?b=1 and javascript:alert(1) with Bearer shd_at_${"A".repeat(43)} and shd_rt_xyz`;
    expect(redactText(text)).toBe("failed for [email] opening [url] and [url] with [token] and [token]");
  });

  it("logs paths without query strings, and with ids, tokens and numbers replaced", () => {
    expect(redactPath(`http://h/api/v1/sessions/${SESSION}?cursor=c1.5.secret#x`)).toBe("/api/v1/sessions/:id");
    expect(redactPath("http://h/api/auth/reset-password/Ab3dEf7hIj9kLm1nOp3qRs5tUv7wXy9z")).toBe("/api/auth/reset-password/:id");
    expect(redactPath("http://h/api/auth/sign-in/email")).toBe("/api/auth/sign-in/email");
    expect(redactPath("http://h/api/v1/devices/me/disconnect")).toBe("/api/v1/devices/me/disconnect");
  });

  it("drops fields whose names suggest secrets or content, whatever they hold", () => {
    expect(redactFields({ status: 200, email: "pat@example.test", authorization: "x", sessionName: "Research", note: "see https://a.test", skipped: undefined })).toEqual({
      status: 200,
      email: "[redacted]",
      authorization: "[redacted]",
      sessionName: "[redacted]",
      note: "see [url]",
    });
  });
});

describe("request ids and access logs", () => {
  it("gives each request an id, returns it, and writes one redacted access line", async () => {
    capture();
    const response = await observeRequest(new Request(`http://h/api/v1/sessions/${SESSION}?cursor=secret`), async () => {
      log("info", "inside", { step: 1 });
      return Response.json({ ok: true });
    });
    const id = response.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(lines.map(({ entry }) => [entry.event, entry.requestId])).toEqual([["inside", id], ["http_request", id]]);
    expect(lines[1]!.entry).toMatchObject({ level: "info", method: "GET", path: "/api/v1/sessions/:id", status: 200 });
    expect(typeof lines[1]!.entry.durationMs).toBe("number");
    expect(JSON.stringify(lines)).not.toContain("secret");
  });

  it("keeps a well-formed request id from the proxy and replaces anything else", async () => {
    capture();
    const run = (id: string) => observeRequest(new Request("http://h/api/v1/devices", { headers: { "x-request-id": id } }), async () => new Response(null, { status: 204 }));
    expect((await run("proxy-abc-12345")).headers.get("x-request-id")).toBe("proxy-abc-12345");
    expect((await run("<script>")).headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("adds the id even to responses with immutable headers", async () => {
    capture();
    const response = await observeRequest(new Request("http://h/api/auth/callback"), async () => Response.redirect("http://h/app", 302));
    expect([response.status, response.headers.get("location"), response.headers.get("x-request-id")?.length]).toEqual([302, "http://h/app", 36]);
  });

  it("routes through handle(): typed errors keep their status; unexpected ones log only their class", async () => {
    capture();
    const ok = handle(async () => json({ ok: true }));
    const refused = handle(async () => {
      throw new HttpError(403, "FORBIDDEN_ORIGIN", "nope");
    });
    const broken = handle(async () => {
      throw new Error("query failed for https://a.test/private and pat@example.test");
    });
    expect((await ok(new Request("http://h/api/v1/workspaces"), {})).headers.get("x-request-id")).toBeTruthy();
    expect((await refused(new Request("http://h/api/v1/workspaces"), {})).status).toBe(403);
    expect((await broken(new Request("http://h/api/v1/workspaces"), {})).status).toBe(500);
    expect(lines.map(({ level, entry }) => [level, entry.event, entry.status ?? entry.errorClass])).toEqual([
      ["info", "http_request", 200],
      ["info", "http_request", 403],
      ["error", "api_unexpected_error", "Error"],
      ["error", "http_request", 500],
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/a\.test|pat@/);
  });
});

describe("bounded bodies", () => {
  const streaming = (bytes: number, chunk = 64 * 1024) =>
    new Request("http://h/api/v1/sessions", {
      method: "POST",
      // A chunked upload: no Content-Length to check up front.
      body: new ReadableStream({
        start(controller) {
          for (let sent = 0; sent < bytes; sent += chunk) controller.enqueue(new Uint8Array(Math.min(chunk, bytes - sent)).fill(120));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);

  it("reads a body up to the limit", async () => {
    expect(await readBodyText(new Request("http://h", { method: "POST", body: '{"a":1}' }), 100)).toBe('{"a":1}');
    expect(await readBodyText(new Request("http://h"), 100)).toBe("");
    expect(await readBodyText(streaming(1000), 1000)).toHaveLength(1000);
  });

  it("refuses a declared or streamed body over the limit without reading it all", async () => {
    expect(await readBodyText(new Request("http://h", { method: "POST", body: "x", headers: { "content-length": "5000" } }), 100)).toBeNull();
    expect(await readBodyText(streaming(5 * 1024 * 1024), 2 * 1024 * 1024)).toBeNull();
  });
});
