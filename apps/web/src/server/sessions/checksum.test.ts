import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { contentChecksum, type SessionContent } from "./checksum";

const content: SessionContent = {
  name: "N",
  description: null,
  workspaceId: null,
  isPinned: false,
  isArchived: false,
  windows: [{ id: randomUUID(), sortOrder: 0, groups: [], tabs: [{ id: randomUUID(), title: "A", url: "https://a.test/", pinned: false, sortOrder: 0, groupId: null, eligibility: "restorable" }] }],
};
const [window] = content.windows;

describe("contentChecksum", () => {
  it("hashes a window without state or bounds exactly as before they existed, so stored checksums still match", () => {
    // The formula as it was before 2026-10-18.
    const before = createHash("sha256").update(JSON.stringify(["N", null, null, false, false, [{ groups: [], tabs: [["A", "https://a.test/", false, null]] }]])).digest("hex");
    expect(contentChecksum(content)).toBe(before);
  });

  it("changes with a window's state or bounds", () => {
    const bounds = { left: 0, top: 0, width: 800, height: 600 };
    const normal = contentChecksum({ ...content, windows: [{ ...window!, state: "normal", bounds }] });
    expect(normal).not.toBe(contentChecksum(content));
    expect(normal).not.toBe(contentChecksum({ ...content, windows: [{ ...window!, state: "normal", bounds: { ...bounds, left: 10 } }] }));
    expect(contentChecksum({ ...content, windows: [{ ...window!, state: "maximized" }] })).not.toBe(contentChecksum({ ...content, windows: [{ ...window!, state: "fullscreen" }] }));
  });
});
