import { createHash } from "node:crypto";
import type { SavedWindow } from "@sessionhub/contracts/session";

export interface SessionContent {
  name: string;
  description: string | null;
  workspaceId: string | null;
  isPinned: boolean;
  isArchived: boolean;
  windows: readonly SavedWindow[];
}

/**
 * SHA-256 of the session's meaning, independent of all ids (child ids are reassigned on
 * every write). Group references become group positions. Used for SessionVersion
 * checksums and to recognise an exact retry of a create. A window's state and bounds count
 * only when present, so a window without them hashes as it did before they existed.
 */
export const contentChecksum = (content: SessionContent): string => {
  const windows = content.windows.map((window) => {
    const groupIndex = new Map(window.groups.map((group, index) => [group.id, index]));
    return {
      groups: window.groups.map((group) => [group.title, group.color, group.collapsed]),
      tabs: window.tabs.map((tab) => [tab.title, tab.url, tab.pinned, tab.groupId === null ? null : (groupIndex.get(tab.groupId) ?? null)]),
      ...(window.state && { state: window.state }),
      ...(window.bounds && { bounds: [window.bounds.left, window.bounds.top, window.bounds.width, window.bounds.height] }),
    };
  });
  const canonical = JSON.stringify([content.name, content.description, content.workspaceId, content.isPinned, content.isArchived, windows]);
  return createHash("sha256").update(canonical).digest("hex");
};
