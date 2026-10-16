import { describe, expect, it } from "vitest";
import { dateBucket, formatListDate, plural } from "./format";

describe("formatListDate", () => {
  const now = new Date(2026, 9, 16, 15, 0);

  it("labels today, yesterday, this year and older dates", () => {
    expect(formatListDate(new Date(2026, 9, 16, 9, 42).toISOString(), now, "en-US")).toBe("Today, 9:42 AM");
    expect(formatListDate(new Date(2026, 9, 15, 23, 0).toISOString(), now, "en-US")).toBe("Yesterday");
    expect(formatListDate(new Date(2026, 9, 14).toISOString(), now, "en-US")).toBe("Oct 14");
    expect(formatListDate(new Date(2025, 9, 14).toISOString(), now, "en-US")).toBe("Oct 14, 2025");
  });

  it("returns an empty string for invalid dates", () => {
    expect(formatListDate("nope", now)).toBe("");
  });
});

describe("plural", () => {
  it("pluralizes with grouping", () => {
    expect(plural(1, "tab")).toBe("1 tab");
    expect(plural(1284, "tab")).toBe("1,284 tabs");
  });
});

describe("dateBucket", () => {
  const now = new Date(2026, 9, 16, 15, 0);
  it("groups by local day", () => {
    expect(dateBucket(new Date(2026, 9, 16, 0, 5).toISOString(), now)).toBe("Today");
    expect(dateBucket(new Date(2026, 9, 15, 23, 59).toISOString(), now)).toBe("Yesterday");
    expect(dateBucket(new Date(2026, 9, 10).toISOString(), now)).toBe("Previous 7 days");
    expect(dateBucket(new Date(2026, 9, 1).toISOString(), now)).toBe("Older");
  });
});

