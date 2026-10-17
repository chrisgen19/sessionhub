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
    const { queueMail, isMailEnabled } = await load({ MAIL_TRANSPORT: "mailpit", MAIL_FROM: "SessionHub <no-reply@example.test>", MAILPIT_URL: "http://127.0.0.1:1" });
    const lines: string[] = [];
    const restore = (await import("../observability/logger")).captureLogs((_level, line) => lines.push(line));
    expect(isMailEnabled()).toBe(true);

    queueMail({ to: "secret-user@example.test", subject: "Reset", text: "https://x.test/?token=tok_123", html: "" });
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    restore();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "warn", event: "mail_delivery_failed", provider: "mailpit", errorMessage: "Mailpit rejected the message (HTTP 503)" });
    expect(lines[0]).not.toMatch(/secret-user|tok_123/);
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
