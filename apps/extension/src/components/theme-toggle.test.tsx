import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY } from "@sessionhub/core/theme";
import { ThemeToggle } from "./theme-toggle";

const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;

afterEach(() => {
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

  it("follows a choice made in another extension page", () => {
    render(<ThemeToggle />);
    act(() => {
      localStorage.setItem(THEME_STORAGE_KEY, "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
    });
    expect(radio("Dark").checked).toBe(true);
  });
});
