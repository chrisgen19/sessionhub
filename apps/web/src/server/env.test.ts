import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("getServerEnv", () => {
  it("rejects a missing or short secret without printing its value", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://x");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("BETTER_AUTH_SECRET", "too-short-secret");
    const { getServerEnv } = await import("./env");
    expect(() => getServerEnv()).toThrow(/BETTER_AUTH_SECRET must be at least 32 characters/);
    expect(() => getServerEnv()).not.toThrow(/too-short-secret/);
  });

  it("accepts a complete configuration", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://x");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("BETTER_AUTH_SECRET", "a".repeat(32));
    const { getServerEnv } = await import("./env");
    expect(getServerEnv().BETTER_AUTH_URL).toBe("http://localhost:3000");
  });
});

describe("getMailConfig", () => {
  it("defaults to disabled", async () => {
    vi.stubEnv("MAIL_TRANSPORT", "");
    const { getMailConfig } = await import("./env");
    expect(getMailConfig()).toEqual({ transport: "disabled" });
  });

  it("parses Resend and Mailpit settings", async () => {
    vi.stubEnv("MAIL_TRANSPORT", "resend");
    vi.stubEnv("MAIL_FROM", "SessionHub <no-reply@example.test>");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const { getMailConfig } = await import("./env");
    expect(getMailConfig()).toEqual({ transport: "resend", from: { email: "no-reply@example.test", name: "SessionHub" }, resendApiKey: "re_test_key" });
  });

  it("uses the default Mailpit URL", async () => {
    vi.stubEnv("MAIL_TRANSPORT", "mailpit");
    vi.stubEnv("MAIL_FROM", "dev@example.test");
    vi.stubEnv("MAILPIT_URL", "");
    const { getMailConfig } = await import("./env");
    expect(getMailConfig()).toMatchObject({ transport: "mailpit", mailpitUrl: "http://127.0.0.1:8025" });
  });

  it("requires a sender and, for Resend, an API key", async () => {
    vi.stubEnv("MAIL_TRANSPORT", "resend");
    vi.stubEnv("MAIL_FROM", "");
    vi.stubEnv("RESEND_API_KEY", "");
    const { getMailConfig } = await import("./env");
    expect(() => getMailConfig()).toThrow(/MAIL_FROM must be an address.*RESEND_API_KEY is required/);
  });

  it("rejects an unknown transport", async () => {
    vi.stubEnv("MAIL_TRANSPORT", "smtp");
    const { getMailConfig } = await import("./env");
    expect(() => getMailConfig()).toThrow(/MAIL_TRANSPORT/);
  });
});
