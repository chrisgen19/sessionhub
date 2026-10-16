import { describe, expect, it } from "vitest";
import { withCallback } from "./auth";

describe("withCallback", () => {
  it("sets our own callback and keeps the token", () => {
    expect(withCallback("http://x.test/api/auth/verify-email?token=abc&callbackURL=%2F", "/email-verified")).toBe(
      "http://x.test/api/auth/verify-email?token=abc&callbackURL=%2Femail-verified",
    );
    expect(withCallback("http://x.test/api/auth/reset-password/tok?callbackURL=", "/reset-password")).toBe(
      "http://x.test/api/auth/reset-password/tok?callbackURL=%2Freset-password",
    );
  });

  it("replaces a callback pointing elsewhere", () => {
    expect(withCallback("http://x.test/api/auth/verify-email?token=abc&callbackURL=https%3A%2F%2Fevil.test", "/email-verified")).not.toContain("evil");
  });
});
