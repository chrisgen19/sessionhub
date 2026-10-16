import { describe, expect, it } from "vitest";
import { pairedAccountSchema } from "./api-pairing";

describe("pairing contracts", () => {
  it("requires a stable account id next to the display fields", () => {
    const account = { id: "Xk3yT9qLm2Pz8RvWc4Nd7Hs1Bf6Gj0Qa", name: "Pat", email: "pat@example.test" };
    expect(pairedAccountSchema.parse(account)).toEqual(account);
    expect(pairedAccountSchema.safeParse({ name: "Pat", email: "pat@example.test" }).success).toBe(false);
  });

  it.each(["", "a:b", "../x", "a b", "x".repeat(129)])("rejects account id %j", (id) => {
    expect(pairedAccountSchema.safeParse({ id, name: "Pat", email: "pat@example.test" }).success).toBe(false);
  });
});
