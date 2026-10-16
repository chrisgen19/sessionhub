import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

const load = async (env: Record<string, string>) => {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("./deliver");
};

describe("queueMail", () => {
  it("sends outside a request scope and logs failures without the recipient or link", async () => {
    const fetch = vi.fn(async () => new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { queueMail, isMailEnabled } = await load({ MAIL_TRANSPORT: "mailpit", MAIL_FROM: "SessionHub <no-reply@example.test>", MAILPIT_URL: "http://127.0.0.1:1" });
    expect(isMailEnabled()).toBe(true);

    queueMail({ to: "secret-user@example.test", subject: "Reset", text: "https://x.test/?token=tok_123", html: "" });
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    const logged = String(error.mock.calls[0]?.[0]);
    expect(logged).toBe("Email delivery via mailpit failed: Mailpit rejected the message (HTTP 503)");
    expect(logged).not.toMatch(/secret-user|tok_123/);
  });

  it("does nothing when email is disabled (the default)", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { queueMail, isMailEnabled } = await load({ MAIL_TRANSPORT: "" });
    expect(isMailEnabled()).toBe(false);
    queueMail({ to: "a@b.test", subject: "s", text: "t", html: "h" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetch).not.toHaveBeenCalled();
  });
});
