import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import { SESSION_SCHEMA_VERSION, type SavedSession } from "@sessionhub/contracts/session";
import { createSessionExport, exportFileName } from "@sessionhub/core/session-export";
import { classifyUrl } from "@sessionhub/core/url-classification";

const toSavedSession = (detail: ApiSessionDetail): SavedSession => ({
  id: detail.id,
  schemaVersion: SESSION_SCHEMA_VERSION,
  name: detail.name,
  createdAt: detail.createdAt,
  updatedAt: detail.updatedAt,
  sourceDeviceId: detail.sourceDeviceId,
  sourceDeviceName: detail.sourceDeviceName,
  version: detail.version,
  windows: detail.windows,
});

/**
 * Downloads the same `sessionhub.session-export` file the extension's Import accepts, so a
 * web session can be restored in a browser without any website-to-extension bridge.
 */
export const buildSessionExport = (detail: ApiSessionDetail, now = new Date()): { fileName: string; contents: string } => {
  const session = toSavedSession(detail);
  return { fileName: exportFileName(session, now), contents: JSON.stringify(createSessionExport(session, now), null, 2) };
};

export const downloadSessionExport = (detail: ApiSessionDetail, now = new Date()): string => {
  const { fileName, contents } = buildSessionExport(detail, now);
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return fileName;
};

/** Only plain web pages are ever opened from the website. */
export const openableUrls = (detail: ApiSessionDetail): string[] =>
  detail.windows.flatMap((window) => window.tabs.map((tab) => tab.url)).filter((url) => classifyUrl(url).eligibility === "restorable");

/**
 * Opens each URL in a new tab with `opener` cut (no reverse tabnabbing). Returns how many the
 * popup blocker stopped, because the browser decides, not us.
 */
export const openLinks = (urls: readonly string[]): { opened: number; blocked: number } => {
  let opened = 0;
  for (const url of urls) {
    const opener = window.open("about:blank", "_blank");
    if (!opener) continue;
    opener.opener = null;
    opener.location.href = url;
    opened += 1;
  }
  return { opened, blocked: urls.length - opened };
};
