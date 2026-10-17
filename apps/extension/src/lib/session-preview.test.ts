import { buildSavedSession } from "@sessionhub/core/capture";
import { describe, expect, it } from "vitest";
import { previewTabs } from "./session-preview";
import { idFactory, sampleSession } from "./test-fixtures";

const titles = (tabs: { title: string }[]) => tabs.map((tab) => tab.title);

const sessionOf = (urls: string[]) =>
  buildSavedSession([{ tabs: urls.map((url, index) => ({ url, title: url, pinned: false, index, groupKey: null })), groups: [] }], {
    name: "Preview",
    now: new Date("2026-10-17T08:00:00.000Z"),
    device: { id: "0d6f6a4e-2f0c-4a43-8f5b-2a7e9a0c1d11", name: "This browser" },
    createId: idFactory(7),
  }).session;

describe("session favicon preview", () => {
  it("takes tabs that can reopen in saved order across windows, skipping browser pages", () => {
    // sampleSession: window 1 = Fix login PR, React docs, Settings (chrome://); window 2 = Example.
    expect(titles(previewTabs(sampleSession()))).toEqual(["Fix login PR", "React docs", "Example"]);
  });

  it("shows each site once, treating www. as the same site, and stops at the limit", () => {
    const session = sessionOf([
      "https://github.com/a",
      "https://www.github.com/b",
      "https://react.dev/",
      "https://github.com/c",
      "https://example.com/",
      "https://mdn.dev/",
      "https://figma.com/",
    ]);
    expect(titles(previewTabs(session))).toEqual(["https://github.com/a", "https://react.dev/", "https://example.com/", "https://mdn.dev/"]);
    expect(titles(previewTabs(session, 2))).toEqual(["https://github.com/a", "https://react.dev/"]);
  });

  it("is empty when nothing can reopen", () => {
    expect(previewTabs(sessionOf(["chrome://settings", "file:///tmp/a.html"]))).toEqual([]);
  });
});
