import { describe, expect, it } from "vitest";
import { formatRelative, formatRelativeInline, initials, plural } from "./format";

describe("formatRelative", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  it.each([
    [new Date("2026-10-16T11:59:30Z"), "Just now"],
    [new Date("2026-10-16T11:55:00Z"), "5m ago"],
    [new Date("2026-10-16T09:00:00Z"), "3h ago"],
    [new Date("2026-10-15T09:00:00Z"), "Yesterday"],
    [new Date("2026-10-01T09:00:00Z"), "Oct 1"],
    [new Date("2025-10-01T09:00:00Z"), "Oct 1, 2025"],
  ])("%s -> %s", (date, expected) => {
    expect(formatRelative(date, now)).toBe(expected);
  });

  it("mid-sentence, lowercases only the words, never a month", () => {
    expect(formatRelativeInline(new Date("2026-10-16T11:59:30Z"), now)).toBe("just now");
    expect(formatRelativeInline(new Date("2026-10-15T09:00:00Z"), now)).toBe("yesterday");
    expect(formatRelativeInline(new Date("2026-10-16T11:55:00Z"), now)).toBe("5m ago");
    expect(formatRelativeInline(new Date("2026-10-01T09:00:00Z"), now)).toBe("Oct 1");
  });
});

describe("helpers", () => {
  it("pluralizes and builds initials", () => {
    expect(plural(1, "tab")).toBe("1 tab");
    expect(plural(1284, "tab")).toBe("1,284 tabs");
    expect(initials("chris diomampo")).toBe("CD");
    expect(initials("  ")).toBe("?");
  });
});
