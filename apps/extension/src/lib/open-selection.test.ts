import { describe, expect, it } from "vitest";
import { allOpenable, isEverything, matchingTabIds, reconcileSaved, savedWindowState, toggleSavedWindow } from "./open-selection";
import { sampleSession } from "./test-fixtures";

// sampleSession: window 1 = Fix login PR (pinned), React docs (group Docs), Settings (chrome://); window 2 = Example.
const session = sampleSession();
const [first, second] = session.windows;
const idOf = (title: string) => session.windows.flatMap((window) => window.tabs).find((tab) => tab.title === title)!.id;

describe("open selection", () => {
  it("starts with every tab that can reopen, never browser pages, re-checked from the url", () => {
    expect(allOpenable(session)).toEqual(new Set([idOf("Fix login PR"), idOf("React docs"), idOf("Example")]));
    const tampered = sampleSession();
    const settings = tampered.windows[0]!.tabs.find((tab) => tab.title === "Settings")!;
    settings.eligibility = "restorable";
    expect(allOpenable(tampered).has(settings.id)).toBe(false);
  });

  it("checks a window once every tab that can reopen is ticked, and toggles only those", () => {
    const all = allOpenable(session);
    expect(savedWindowState(first!, all)).toBe("checked");
    expect(savedWindowState(first!, new Set([idOf("React docs")]))).toBe("mixed");
    expect(savedWindowState(first!, new Set())).toBe("unchecked");

    const without = toggleSavedWindow(all, first!);
    expect(without).toEqual(new Set([idOf("Example")]));
    expect(toggleSavedWindow(without, first!)).toEqual(all);
    expect(toggleSavedWindow(new Set(), second!)).toEqual(new Set([idOf("Example")]));
  });

  it("selects tabs matching the search by title or url", () => {
    expect(matchingTabIds(session, "react")).toEqual(new Set([idOf("React docs")]));
    expect(matchingTabIds(session, "example.com")).toEqual(new Set([idOf("Example")]));
    // A browser page never matches, and the session's own name isn't a tab match.
    expect(matchingTabIds(session, "settings")).toEqual(new Set());
    expect(matchingTabIds(session, "alpha")).toEqual(new Set());
  });

  it("drops ids that left the session and says when everything is ticked", () => {
    const stale = new Set([idOf("Example"), "00000000-0000-4000-8000-00000000dead"]);
    expect(reconcileSaved(stale, session)).toEqual(new Set([idOf("Example")]));
    const kept = new Set([idOf("Example")]);
    expect(reconcileSaved(kept, session)).toBe(kept);

    expect(isEverything(allOpenable(session), session)).toBe(true);
    expect(isEverything(kept, session)).toBe(false);
  });
});
