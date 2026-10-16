import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-errors";

describe("authErrorMessage", () => {
  it("maps known Better Auth codes", () => {
    expect(authErrorMessage({ status: 422, code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" })).toMatch(/already exists/);
    expect(authErrorMessage({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" })).toBe("Email or password is incorrect.");
  });

  it("explains rate limiting whatever the code", () => {
    expect(authErrorMessage({ status: 429 })).toBe("Too many attempts. Wait a minute and try again.");
  });

  it("falls back for unknown codes and network failures", () => {
    expect(authErrorMessage({ status: 400, code: "SOMETHING_NEW" })).toBe("That didn't work. Check your details and try again.");
    expect(authErrorMessage(null)).toMatch(/couldn't reach/);
  });
});
