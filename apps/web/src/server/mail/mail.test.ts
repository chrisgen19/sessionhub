import { describe, expect, it, vi } from "vitest";
import { createMailpitTransport } from "./mailpit";
import { createResendTransport, RESEND_ENDPOINT } from "./resend";
import { passwordChangedEmail, passwordResetEmail, verificationEmail } from "./templates";
import { formatAddress, parseAddress } from "./types";

const message = { to: "user@example.test", subject: "Hi", text: "Plain", html: "<p>Rich</p>" };
const ok = () => vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => new Response(JSON.stringify({ id: "x" }), { status: 200 }));

describe("addresses", () => {
  it.each([
    ["SessionHub <no-reply@example.test>", { email: "no-reply@example.test", name: "SessionHub" }],
    ['"Session Hub" <a@b.test>', { email: "a@b.test", name: "Session Hub" }],
    ["<a@b.test>", { email: "a@b.test", name: undefined }],
    ["  a@b.test ", { email: "a@b.test" }],
  ])("parses %s", (input, expected) => {
    expect(parseAddress(input)).toEqual(expected);
  });

  it("formats with and without a name", () => {
    expect(formatAddress({ email: "a@b.test", name: "A" })).toBe("A <a@b.test>");
    expect(formatAddress({ email: "a@b.test" })).toBe("a@b.test");
  });
});

describe("Resend transport", () => {
  it("posts the documented JSON body with a bearer key", async () => {
    const fetch = ok();
    await createResendTransport({ apiKey: "re_secret", from: { email: "no-reply@example.test", name: "SessionHub" }, fetch }).send(message);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer re_secret");
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "SessionHub <no-reply@example.test>",
      to: ["user@example.test"],
      subject: "Hi",
      text: "Plain",
      html: "<p>Rich</p>",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails with the status only, never the key, recipient or response body", async () => {
    const fetch = vi.fn(async () => new Response('{"message":"bad key re_secret for user@example.test"}', { status: 403 }));
    const send = createResendTransport({ apiKey: "re_secret", from: { email: "a@b.test" }, fetch }).send(message);
    await expect(send).rejects.toThrow("Resend rejected the message (HTTP 403)");
    await send.catch((error: unknown) => {
      expect(String(error)).not.toMatch(/re_secret|user@example\.test/);
    });
  });
});

describe("Mailpit transport", () => {
  it("posts to /api/v1/send with Mailpit's field names", async () => {
    const fetch = ok();
    await createMailpitTransport({ baseUrl: "http://127.0.0.1:58025", from: { email: "no-reply@example.test", name: "SessionHub" }, fetch }).send(message);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:58025/api/v1/send");
    expect(JSON.parse(String(init?.body))).toEqual({
      From: { Email: "no-reply@example.test", Name: "SessionHub" },
      To: [{ Email: "user@example.test" }],
      Subject: "Hi",
      Text: "Plain",
      HTML: "<p>Rich</p>",
    });
  });

  it("throws on a non-2xx answer", async () => {
    const fetch = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(createMailpitTransport({ baseUrl: "http://x.test", from: { email: "a@b.test" }, fetch }).send(message)).rejects.toThrow("HTTP 500");
  });
});

describe("templates", () => {
  const url = "http://localhost:3000/api/auth/verify-email?token=abc&callbackURL=%2Femail-verified";

  it("escapes the user's name and the link in HTML, and keeps the raw link in text", () => {
    const email = verificationEmail("u@example.test", '<img src=x onerror="alert(1)">', url);
    expect(email.to).toBe("u@example.test");
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(email.html).toContain('href="http://localhost:3000/api/auth/verify-email?token=abc&amp;callbackURL=%2Femail-verified"');
    expect(email.text).toContain(`Confirm email: ${url}`);
  });

  it("states expiry and what happens in each message", () => {
    expect(verificationEmail("u@x.test", "U", url).text).toMatch(/24 hours/);
    const reset = passwordResetEmail("u@x.test", "U", url);
    expect(reset.subject).toBe("Reset your SessionHub password");
    expect(reset.text).toMatch(/1 hour and only once/);
    expect(reset.text).toMatch(/Your password stays the same/);
    const changed = passwordChangedEmail("u@x.test", "U");
    expect(changed.text).toMatch(/signed out/);
    expect(changed.html).not.toContain("href=");
  });
});
