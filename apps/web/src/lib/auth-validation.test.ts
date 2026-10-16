import { describe, expect, it } from "vitest";
import { fieldErrors, safeNextPath, signInSchema, signUpSchema } from "./auth-validation";

describe("safeNextPath", () => {
  it.each([
    ["/app", "/app"],
    ["/app/sessions?x=1#top", "/app/sessions?x=1#top"],
  ])("keeps same-site path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    "//evil.test/path",
    "/\\evil.test",
    "https://evil.test/",
    "javascript:alert(1)",
    "app",
    "",
    undefined,
    null,
    ["/app"],
  ])("falls back for %s", (input) => {
    expect(safeNextPath(input)).toBe("/app");
  });
});

describe("auth schemas", () => {
  it("accepts valid sign-up input and trims the name", () => {
    expect(signUpSchema.parse({ name: "  Chris ", email: "c@example.test", password: "correct horse" })).toEqual({
      name: "Chris",
      email: "c@example.test",
      password: "correct horse",
    });
  });

  it("reports one message per field", () => {
    const result = signUpSchema.safeParse({ name: "", email: "nope", password: "short" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error)).toEqual({
        name: "Enter your name",
        email: "Enter a valid email address",
        password: "Use at least 10 characters",
      });
    }
  });

  it("rejects overlong passwords and empty sign-in passwords", () => {
    expect(signUpSchema.safeParse({ name: "a", email: "a@b.test", password: "x".repeat(129) }).success).toBe(false);
    expect(signInSchema.safeParse({ email: "a@b.test", password: "" }).success).toBe(false);
  });
});
