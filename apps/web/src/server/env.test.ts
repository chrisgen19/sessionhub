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
    expect(getServerEnv()).toMatchObject({ BETTER_AUTH_URL: "http://localhost:3000", TRUSTED_PROXY_COUNT: 1 });
  });

  it("requires https in production, except for this machine", async () => {
    const load = async (url: string) => {
      vi.resetModules();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DATABASE_URL", "postgresql://x");
      vi.stubEnv("BETTER_AUTH_SECRET", "a".repeat(32));
      vi.stubEnv("BETTER_AUTH_URL", url);
      return (await import("./env")).getServerEnv;
    };
    await expect(load("http://sessionhub.example").then((get) => get())).rejects.toThrow(/must use https in production/);
    for (const url of ["https://sessionhub.example", "http://localhost:3030", "http://127.0.0.1:3100", "http://[::1]:3000"]) {
      expect((await load(url))().BETTER_AUTH_URL).toBe(url);
    }
  });

  it("names the problem for the health check, without values", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://x");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("BETTER_AUTH_SECRET", "too-short-secret");
    vi.stubEnv("MAIL_TRANSPORT", "");
    const { configurationProblem } = await import("./env");
    expect(configurationProblem()).toMatch(/^Invalid server environment: BETTER_AUTH_SECRET/);
    expect(configurationProblem()).not.toContain("too-short-secret");
    vi.resetModules();
    vi.stubEnv("BETTER_AUTH_SECRET", "a".repeat(32));
    expect((await import("./env")).configurationProblem()).toBeNull();
  });

  it("reads the trusted proxy count and rejects nonsense", async () => {
    const load = async (count: string) => {
      vi.resetModules();
      vi.stubEnv("DATABASE_URL", "postgresql://x");
      vi.stubEnv("BETTER_AUTH_SECRET", "a".repeat(32));
      vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
      vi.stubEnv("TRUSTED_PROXY_COUNT", count);
      return (await import("./env")).getServerEnv;
    };
    expect((await load("2"))().TRUSTED_PROXY_COUNT).toBe(2);
    expect((await load(""))().TRUSTED_PROXY_COUNT).toBe(1);
    for (const count of ["0", "6", "1.5", "all"]) expect(await load(count)).toThrow(/TRUSTED_PROXY_COUNT/);
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
