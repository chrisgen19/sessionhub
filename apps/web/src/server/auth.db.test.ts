import { randomUUID } from "node:crypto";
import { isAPIError } from "better-auth/api";
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "@sessionhub/database/client";
import { getAuth } from "./auth";

const email = () => `auth-${randomUUID()}@example.test`;
const password = "correct horse battery";

afterAll(async () => {
  await getPrisma().$disconnect();
});

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return isAPIError(error) ? error.body?.code : "not-an-api-error";
  }
  return "resolved";
};

describe("Better Auth on PostgreSQL", () => {
  it("signs up with a hashed password and an active session", async () => {
    const address = email();
    const result = await getAuth().api.signUpEmail({ body: { name: "Chris", email: address, password } });
    expect(result.user.email).toBe(address);
    expect(result.token).toBeTruthy();

    const account = await getPrisma().account.findFirstOrThrow({ where: { userId: result.user.id, providerId: "credential" } });
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain(password);
    expect(await getPrisma().session.count({ where: { userId: result.user.id } })).toBe(1);
  });

  it("signs in with the right password and rejects a wrong one", async () => {
    const address = email();
    await getAuth().api.signUpEmail({ body: { name: "Chris", email: address, password } });
    await expect(getAuth().api.signInEmail({ body: { email: address, password } })).resolves.toMatchObject({ user: { email: address } });
    expect(await codeOf(getAuth().api.signInEmail({ body: { email: address, password: "wrong password!" } }))).toBe(
      "INVALID_EMAIL_OR_PASSWORD",
    );
    expect(await codeOf(getAuth().api.signInEmail({ body: { email: email(), password } }))).toBe("INVALID_EMAIL_OR_PASSWORD");
  });

  it("refuses a second account for the same email and short passwords", async () => {
    const address = email();
    await getAuth().api.signUpEmail({ body: { name: "Chris", email: address, password } });
    expect(await codeOf(getAuth().api.signUpEmail({ body: { name: "Again", email: address, password } }))).toMatch(/^USER_ALREADY_EXISTS/);
    expect(await codeOf(getAuth().api.signUpEmail({ body: { name: "Short", email: email(), password: "short" } }))).toBe(
      "PASSWORD_TOO_SHORT",
    );
    expect(await getPrisma().user.count({ where: { email: address } })).toBe(1);
  });

  it("enforces name rules on the server, whatever the client sends", async () => {
    expect(await codeOf(getAuth().api.signUpEmail({ body: { name: "x".repeat(121), email: email(), password } }))).toBe("INVALID_NAME");
    expect(await codeOf(getAuth().api.signUpEmail({ body: { name: "   ", email: email(), password } }))).toBe("INVALID_NAME");
    const result = await getAuth().api.signUpEmail({ body: { name: "  Chris  ", email: email(), password } });
    expect(result.user.name).toBe("Chris");
  });
});

