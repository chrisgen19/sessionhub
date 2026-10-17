import type { SavedWindow } from "@sessionhub/contracts/session";
import type { ReviewChoice, ReviewKind } from "@sessionhub/sync/review";

/** Plain-language copy for conflict review (docs/UI_UX_DESIGN.md 18f). */

export const REVIEW_EXPLANATION: Record<ReviewKind, string> = {
  "edit-conflict": "This session was changed in this browser and somewhere else. Both versions are kept until you choose.",
  "deleted-on-server": "This session was changed here, but deleted in another browser or on the website.",
  "delete-conflict": "You deleted this session here, but it was changed somewhere else before the delete reached your account.",
  "id-in-use": "Your account already has a different session with this session's ID, so it couldn't be uploaded.",
  rejected: "Your account can't accept this session as it is.",
};

export const REVIEW_CHOICE_TEXT: Record<ReviewKind, Partial<Record<ReviewChoice, { label: string; detail: string }>>> = {
  "edit-conflict": {
    "keep-mine": { label: "Keep mine", detail: "Upload this browser's version over the other one." },
    "keep-server": { label: "Keep the other version", detail: "Replace this browser's version with the other one." },
    "save-both": { label: "Keep both", detail: "Keep the other version, and save this browser's as a separate session." },
  },
  "deleted-on-server": {
    "keep-mine": { label: "Keep mine as a new session", detail: "Upload this browser's version as a new session." },
    "keep-server": { label: "Delete it here too", detail: "Remove it from this browser, like everywhere else." },
  },
  "delete-conflict": {
    "keep-server": { label: "Restore the other version", detail: "Bring the session back with the changes made elsewhere." },
    "keep-mine": { label: "Delete it everywhere", detail: "Delete the changed version too." },
  },
  "id-in-use": {
    "keep-mine": { label: "Upload as a new session", detail: "Give it a new ID and upload it." },
    "local-only": { label: "Keep in this browser only", detail: "Stop syncing it. It stays here." },
    "keep-server": { label: "Drop this change", detail: "It was deleted here. Nothing is uploaded, and your account's session with this ID stays." },
  },
  rejected: {
    "local-only": { label: "Keep in this browser only", detail: "Stop syncing it. It stays here, unchanged." },
    "keep-server": { label: "Drop this change", detail: "It was deleted here. Nothing is uploaded, and your account keeps what it had." },
  },
};

export interface VersionDiff {
  tabs: [number, number];
  windows: [number, number];
  /** Links only in this browser's version / only in the other one (first few, for display). */
  onlyHere: string[];
  onlyThere: string[];
  onlyHereCount: number;
  onlyThereCount: number;
}

const links = (windows: SavedWindow[]) => new Set(windows.flatMap((window) => window.tabs.map((tab) => tab.url)));

/** What differs between the two versions' tabs, in a form a person can scan. */
export const diffVersions = (mine: SavedWindow[], theirs: SavedWindow[], show = 3): VersionDiff => {
  const [here, there] = [links(mine), links(theirs)];
  const onlyHere = [...here].filter((url) => !there.has(url));
  const onlyThere = [...there].filter((url) => !here.has(url));
  const count = (windows: SavedWindow[]) => windows.reduce((sum, window) => sum + window.tabs.length, 0);
  return {
    tabs: [count(mine), count(theirs)],
    windows: [mine.length, theirs.length],
    onlyHere: onlyHere.slice(0, show),
    onlyThere: onlyThere.slice(0, show),
    onlyHereCount: onlyHere.length,
    onlyThereCount: onlyThere.length,
  };
};
