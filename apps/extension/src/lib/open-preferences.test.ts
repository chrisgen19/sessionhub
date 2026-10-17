import { afterEach, describe, expect, it, vi } from "vitest";
import { readOpenTarget, readSkipOpen, saveOpenTarget, saveSkipOpen } from "./open-preferences";

afterEach(() => vi.restoreAllMocks());

describe("open preferences", () => {
  it("defaults to new windows with skipping on, and remembers changes", () => {
    expect(readOpenTarget()).toBe("new-windows");
    expect(readSkipOpen()).toBe(true);
    saveOpenTarget("this-window");
    saveSkipOpen(false);
    expect(readOpenTarget()).toBe("this-window");
    expect(readSkipOpen()).toBe(false);
  });

  it("ignores an unknown stored value", () => {
    localStorage.setItem("sessionhub-open-target", "replace-window");
    expect(readOpenTarget()).toBe("new-windows");
  });

  it("falls back to the defaults when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => saveOpenTarget("one-window")).not.toThrow();
    expect(readOpenTarget()).toBe("new-windows");
    expect(readSkipOpen()).toBe(true);
  });
});
