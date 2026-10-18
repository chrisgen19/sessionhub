import {
  SESSION_SCHEMA_VERSION,
  type RestoreEligibility,
  type SavedSession,
  type SavedWindow,
} from "@sessionhub/contracts/session";
import { SESSION_EXPORT_FORMAT, sessionExportSchema, type SessionExport } from "@sessionhub/contracts/session-export";
import { classifyUrl } from "./url-classification";
import { normalizePlacement } from "./window-placement";

/** Largest import file accepted (bytes). Bounds memory before JSON parsing. */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export type SessionImportErrorCode =
  | "too-large"
  | "not-json"
  | "wrong-format"
  | "unsupported-version"
  | "invalid-structure"
  | "empty";

export class SessionImportError extends Error {
  override name = "SessionImportError";
  constructor(
    readonly code: SessionImportErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Parses and validates an untrusted export file. Checks run cheapest first so a
 * wrong or oversized file fails with a specific, user-readable message.
 */
export const parseSessionExport = (text: string): SessionExport => {
  if (new TextEncoder().encode(text).length > IMPORT_MAX_BYTES) {
    throw new SessionImportError("too-large", "This file is larger than 10 MB, so it can't be imported.");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SessionImportError("not-json", "This file isn't valid JSON.");
  }
  if (!isRecord(data) || data.format !== SESSION_EXPORT_FORMAT) {
    throw new SessionImportError("wrong-format", "This isn't a SessionHub session export.");
  }
  const version = data.schemaVersion;
  if (typeof version === "number" && Number.isInteger(version) && version > SESSION_SCHEMA_VERSION) {
    throw new SessionImportError(
      "unsupported-version",
      `This file was made by a newer version of SessionHub (format ${version}). Update the extension and try again.`,
    );
  }
  const result = sessionExportSchema.safeParse(data);
  if (!result.success) {
    const [issue] = result.error.issues;
    const where = issue && issue.path.length > 0 ? ` (at ${issue.path.join(".")})` : "";
    throw new SessionImportError("invalid-structure", `This file is damaged or incomplete: ${issue?.message ?? "invalid data"}${where}.`);
  }
  return result.data;
};

export interface ImportReport {
  windowCount: number;
  tabCount: number;
  /** Tabs saved as reference only after re-classification, keyed by eligibility. */
  notRestorable: Partial<Record<Exclude<RestoreEligibility, "restorable">, number>>;
  /** Tabs whose eligibility in the file disagreed with the current classifier. */
  reclassifiedCount: number;
  exportedAt: string;
}

export interface PrepareImportOptions {
  now: Date;
  createId: () => string;
}

/** Stable order by saved sortOrder, then file position; renumbered from 0 without gaps. */
const reorder = <T extends { sortOrder: number }>(items: readonly T[]): T[] =>
  items
    .map((item, position) => ({ item, position }))
    .sort((a, b) => a.item.sortOrder - b.item.sortOrder || a.position - b.position)
    .map(({ item }, sortOrder) => ({ ...item, sortOrder }));

const reidentifyWindow = (
  window: SavedWindow,
  createId: () => string,
  report: Pick<ImportReport, "notRestorable" | "reclassifiedCount">,
): SavedWindow => {
  const groupIds = new Map(window.groups.map((group) => [group.id, createId()]));
  const tabs = reorder(window.tabs).map((tab) => {
    const { eligibility } = classifyUrl(tab.url);
    if (eligibility !== tab.eligibility) report.reclassifiedCount += 1;
    if (eligibility !== "restorable") report.notRestorable[eligibility] = (report.notRestorable[eligibility] ?? 0) + 1;
    return { ...tab, id: createId(), groupId: tab.groupId === null ? null : (groupIds.get(tab.groupId) ?? null), eligibility };
  });
  const groups = reorder(window.groups).map((group) => ({ ...group, id: groupIds.get(group.id) ?? createId() }));
  // State and bounds stay with the window; bounds only ever apply on the computer that saved it.
  return { id: createId(), sortOrder: window.sortOrder, groups, tabs, ...normalizePlacement(window) };
};

/**
 * Turns a validated export into a brand-new local session: every id is fresh (so an
 * import can never replace an existing record), URLs are re-classified, ordering is
 * normalized and the session is marked as imported (`sourceDeviceId: null`).
 */
export const prepareImportedSession = (
  file: SessionExport,
  options: PrepareImportOptions,
): { session: SavedSession; report: ImportReport } => {
  const report: ImportReport = {
    windowCount: 0,
    tabCount: 0,
    notRestorable: {},
    reclassifiedCount: 0,
    exportedAt: file.exportedAt,
  };
  const windows = reorder(file.session.windows.filter((window) => window.tabs.length > 0)).map((window) =>
    reidentifyWindow(window, options.createId, report),
  );
  report.windowCount = windows.length;
  report.tabCount = windows.reduce((sum, window) => sum + window.tabs.length, 0);
  if (report.tabCount === 0) throw new SessionImportError("empty", "This file doesn't contain any tabs.");

  const timestamp = options.now.toISOString();
  const session: SavedSession = {
    id: options.createId(),
    schemaVersion: SESSION_SCHEMA_VERSION,
    name: file.session.name,
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceDeviceId: null,
    sourceDeviceName: file.session.sourceDeviceName,
    version: 1,
    windows,
    // Notes and tags come along; an import is a new session in the list, so neither pinned nor archived.
    ...(file.session.description && { description: file.session.description }),
    ...(file.session.tags?.length && { tags: file.session.tags }),
  };
  return { session, report };
};

/**
 * Copies a stored session (a recovery checkpoint) as a brand-new saved session. Every id
 * is fresh, as for an import, so the copy can never replace the original or an earlier
 * copy. Name and source device are kept; the copy is version 1, saved at `now`.
 */
export const copyAsNewSession = (session: SavedSession, options: PrepareImportOptions): SavedSession => {
  const timestamp = options.now.toISOString();
  const report = { notRestorable: {}, reclassifiedCount: 0 };
  return {
    ...session,
    id: options.createId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    windows: reorder(session.windows.filter((window) => window.tabs.length > 0)).map((window) =>
      reidentifyWindow(window, options.createId, report),
    ),
  };
};
