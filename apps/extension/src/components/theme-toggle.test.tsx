import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setThemePreference, THEME_STORAGE_KEY } from "@sessionhub/core/theme";
import { ThemeToggle } from "./theme-toggle";

const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;

afterEach(() => {
  vi.restoreAllMocks();
  // A saved choice clears one storage refused (kept per page, so it would leak into the next test).
  setThemePreference("light");
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("theme toggle", () => {
  it("starts on Light and remembers the choice it applies", async () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy();
    expect(radio("Light").checked).toBe(true);

    await userEvent.click(radio("Dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    // System follows the browser, which is light in this test.
    await userEvent.click(radio("System"));
    expect(radio("System").checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("keeps the choice for the open page when storage can't save it (blocked site data)", async () => {
    const blocked = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    render(<ThemeToggle />);
    await userEvent.click(radio("Dark"));
    expect(radio("Dark").checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows a choice made in another extension page", () => {
    render(<ThemeToggle />);
    act(() => {
      localStorage.setItem(THEME_STORAGE_KEY, "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
    });
    expect(radio("Dark").checked).toBe(true);
  });
});
