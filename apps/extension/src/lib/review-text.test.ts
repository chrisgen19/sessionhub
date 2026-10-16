import { describe, expect, it } from "vitest";
import { reviewChoices, type ReviewKind } from "@sessionhub/sync/review";
import { diffVersions, REVIEW_CHOICE_TEXT } from "./review-text";
import { sampleSession } from "./test-fixtures";

describe("review copy", () => {
  it("has a label for every choice any situation can offer", () => {
    const kinds: ReviewKind[] = ["edit-conflict", "deleted-on-server", "delete-conflict", "id-in-use", "rejected"];
    for (const kind of kinds) {
      const offered = reviewChoices(kind, { operation: { action: "upsert", status: "conflict", code: null }, hasLocalRecord: true, serverCopy: { action: "upsert", version: 2 }, conflictServerVersion: 2 });
      for (const choice of offered) expect(REVIEW_CHOICE_TEXT[kind][choice]?.label).toBeTruthy();
    }
  });
});

describe("diffVersions", () => {
  it("counts tabs and windows on both sides and lists the links that differ", () => {
    const mine = sampleSession({}, 1);
    const theirs = sampleSession({}, 2);
    const [first, second] = theirs.windows;
    const changed = [{ ...first!, tabs: [...first!.tabs.slice(1), { ...first!.tabs[0]!, url: "https://new.test/" }] }, second!];
    expect(diffVersions(mine.windows, changed)).toEqual({
      tabs: [4, 4],
      windows: [2, 2],
      onlyHere: ["https://github.com/acme/pull/42"],
      onlyThere: ["https://new.test/"],
      onlyHereCount: 1,
      onlyThereCount: 1,
    });
    expect(diffVersions(mine.windows, mine.windows)).toMatchObject({ onlyHereCount: 0, onlyThereCount: 0 });
  });
});
