import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import { sessionExportSchema } from "@sessionhub/contracts/session-export";
import { parseSessionExport, prepareImportedSession } from "@sessionhub/core/session-import";
import { describe, expect, it } from "vitest";
import { buildSessionExport, openableUrls } from "./session-files";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const detail: ApiSessionDetail = {
  id: id(1),
  name: "Client Alpha: PR review",
  description: null,
  workspaceId: null,
  sourceDeviceId: null,
  sourceDeviceName: "Web",
  isPinned: false,
  isArchived: false,
  version: 3,
  tabCount: 4,
  windowCount: 1,
  createdAt: "2026-10-16T08:00:00.000Z",
  updatedAt: "2026-10-16T09:00:00.000Z",
  windows: [
    {
      id: id(2),
      sortOrder: 0,
      groups: [{ id: id(3), title: "Docs", color: "blue", collapsed: false, sortOrder: 0 }],
      tabs: [
        { id: id(4), title: "A", url: "https://a.test/", pinned: true, sortOrder: 0, groupId: null, eligibility: "restorable" },
        { id: id(5), title: "B", url: "https://b.test/x?y=1", pinned: false, sortOrder: 1, groupId: id(3), eligibility: "restorable" },
        { id: id(6), title: "Settings", url: "chrome://settings", pinned: false, sortOrder: 2, groupId: null, eligibility: "browser-internal" },
        // Stored eligibility is wrong on purpose: the web must re-check, not trust it.
        { id: id(7), title: "Evil", url: "javascript:alert(1)", pinned: false, sortOrder: 3, groupId: null, eligibility: "restorable" },
      ],
    },
  ],
};

describe("buildSessionExport", () => {
  it("produces a valid export file that the extension's import accepts", () => {
    const { fileName, contents } = buildSessionExport(detail, new Date("2026-10-16T10:00:00.000Z"));
    expect(fileName).toBe("sessionhub-client-alpha-pr-review-2026-10-16.json");
    expect(sessionExportSchema.safeParse(JSON.parse(contents)).success).toBe(true);

    // The same functions the extension's Import uses.
    const imported = prepareImportedSession(parseSessionExport(contents), { now: new Date(), createId: () => crypto.randomUUID() });
    expect(imported.session.name).toBe(detail.name);
    expect(imported.report).toMatchObject({ windowCount: 1, tabCount: 4 });
    expect(imported.session.windows[0]!.tabs[3]!.eligibility).toBe("unsafe");
  });
});

describe("openableUrls", () => {
  it("returns only plain web pages, re-checking every url", () => {
    expect(openableUrls(detail)).toEqual(["https://a.test/", "https://b.test/x?y=1"]);
  });
});
