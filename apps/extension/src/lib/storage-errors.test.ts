import { Dexie } from "dexie";
import { describe, expect, it } from "vitest";
import { isQuotaError } from "./storage-errors";

describe("isQuotaError", () => {
  it.each<[string, unknown]>([
    ["a DOMException by name", new DOMException("full", "QuotaExceededError")],
    ["Dexie's mapped error", new Dexie.QuotaExceededError("full")],
    ["an AbortError wrapping it", new Dexie.AbortError("aborted", new DOMException("full", "QuotaExceededError"))],
    ["a nested cause", new Error("outer", { cause: new Error("mid", { cause: { name: "QuotaExceededError" } }) })],
    ["a bulk failure", Object.assign(new Error("bulk"), { failures: [new Error("other"), { name: "QuotaExceededError" }] })],
  ])("detects %s", (_label, error) => {
    expect(isQuotaError(error)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["a constraint error", new Dexie.ConstraintError("dup")],
    ["a plain abort", new Dexie.AbortError("aborted")],
    ["a string", "QuotaExceededError"],
    ["null", null],
  ])("ignores %s", (_label, error) => {
    expect(isQuotaError(error)).toBe(false);
  });

  it("stops on self-referencing errors", () => {
    const loop: { name: string; inner?: unknown } = { name: "Error" };
    loop.inner = loop;
    expect(isQuotaError(loop)).toBe(false);
  });
});
