import { describe, expect, it } from "vitest";
import { noticeForError } from "./notices";

describe("noticeForError", () => {
  it("explains rate limiting with the wait time and that nothing changed", () => {
    expect(noticeForError({ code: "RATE_LIMITED", message: "x", retryAfterSeconds: 4 })).toEqual({
      tone: "error",
      text: "You're making changes too quickly. Try again in 4 seconds. Nothing was changed.",
    });
  });

  it("marks conflicts separately so the page offers Load latest", () => {
    expect(noticeForError({ code: "VERSION_CONFLICT", message: "x", serverVersion: 7 })).toMatchObject({ tone: "conflict", text: expect.stringContaining("now version 7") });
  });

  it("falls back to the server's message", () => {
    expect(noticeForError({ code: "INVALID_WORKSPACE", message: "That workspace doesn't exist in your account." }).text).toBe(
      "That workspace doesn't exist in your account.",
    );
  });
});
