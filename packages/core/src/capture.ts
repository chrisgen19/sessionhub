import {
  SESSION_LIMITS,
  SESSION_SCHEMA_VERSION,
  tabGroupColorSchema,
  type RestoreEligibility,
  type SavedGroup,
  type SavedSession,
  type SavedTab,
  type SavedWindow,
} from "@sessionhub/contracts/session";
import { classifyUrl } from "./url-classification";

/**
 * Browser-agnostic capture input. `groupKey` / `key` are runtime browser group IDs:
 * they are only used to link tabs to groups during capture and are never persisted.
 */
export interface CaptureTabInput {
  url: string;
  title: string;
  pinned: boolean;
  index: number;
  groupKey: number | null;
}

export interface CaptureGroupInput {
  key: number;
  title: string;
  color: string;
  collapsed: boolean;
}

export interface CaptureWindowInput {
  tabs: CaptureTabInput[];
  groups: CaptureGroupInput[];
}

export interface BuildSessionOptions {
  name: string;
  now: Date;
  device: { id: string; name: string };
  createId: () => string;
}

export interface CaptureReport {
  windowCount: number;
  tabCount: number;
  emptyWindowsSkipped: number;
  /** Tabs saved as metadata only, keyed by eligibility. */
  notRestorable: Partial<Record<Exclude<RestoreEligibility, "restorable">, number>>;
}

export class CaptureLimitError extends Error {
  override name = "CaptureLimitError";
}

const buildGroups = (
  input: CaptureWindowInput,
  createId: () => string,
): { groups: SavedGroup[]; idByKey: Map<number, string> } => {
  const usedKeys = new Set(input.tabs.map((tab) => tab.groupKey).filter((key) => key !== null));
  const firstIndex = (key: number) =>
    Math.min(...input.tabs.filter((tab) => tab.groupKey === key).map((tab) => tab.index));
  const idByKey = new Map<number, string>();
  const groups = input.groups
    .filter((group) => usedKeys.has(group.key))
    .sort((a, b) => firstIndex(a.key) - firstIndex(b.key))
    .map((group, sortOrder): SavedGroup => {
      const id = createId();
      idByKey.set(group.key, id);
      const color = tabGroupColorSchema.safeParse(group.color);
      return {
        id,
        title: group.title.slice(0, SESSION_LIMITS.groupTitleMax),
        color: color.success ? color.data : "grey",
        collapsed: group.collapsed,
        sortOrder,
      };
    });
  return { groups, idByKey };
};

const buildWindow = (
  input: CaptureWindowInput,
  sortOrder: number,
  createId: () => string,
  report: CaptureReport,
): SavedWindow => {
  const { groups, idByKey } = buildGroups(input, createId);
  const tabs = [...input.tabs]
    .sort((a, b) => a.index - b.index)
    .map((tab, tabOrder): SavedTab => {
      const { eligibility } = classifyUrl(tab.url);
      if (eligibility !== "restorable") {
        report.notRestorable[eligibility] = (report.notRestorable[eligibility] ?? 0) + 1;
      }
      return {
        id: createId(),
        title: tab.title.slice(0, SESSION_LIMITS.titleMax),
        url: tab.url.slice(0, SESSION_LIMITS.urlMax),
        pinned: tab.pinned,
        sortOrder: tabOrder,
        groupId: tab.groupKey === null ? null : (idByKey.get(tab.groupKey) ?? null),
        eligibility,
      };
    });
  return { id: createId(), sortOrder, groups, tabs };
};

/**
 * Normalizes observed browser windows into a new SavedSession with fresh UUIDs.
 * Windows without tabs are skipped and counted; non-restorable tabs are kept as
 * metadata so nothing is silently omitted.
 */
export const buildSavedSession = (
  windows: CaptureWindowInput[],
  options: BuildSessionOptions,
): { session: SavedSession; report: CaptureReport } => {
  const report: CaptureReport = { windowCount: 0, tabCount: 0, emptyWindowsSkipped: 0, notRestorable: {} };
  const nonEmpty = windows.filter((window) => window.tabs.length > 0);
  report.emptyWindowsSkipped = windows.length - nonEmpty.length;

  if (nonEmpty.length > SESSION_LIMITS.windowsMax) {
    throw new CaptureLimitError(`Too many windows to save (max ${SESSION_LIMITS.windowsMax})`);
  }
  if (nonEmpty.some((window) => window.tabs.length > SESSION_LIMITS.tabsPerWindowMax)) {
    throw new CaptureLimitError(`A window has too many tabs (max ${SESSION_LIMITS.tabsPerWindowMax})`);
  }

  const savedWindows = nonEmpty.map((window, index) => buildWindow(window, index, options.createId, report));
  report.windowCount = savedWindows.length;
  report.tabCount = savedWindows.reduce((sum, window) => sum + window.tabs.length, 0);

  const timestamp = options.now.toISOString();
  const session: SavedSession = {
    id: options.createId(),
    schemaVersion: SESSION_SCHEMA_VERSION,
    name: options.name.trim().slice(0, SESSION_LIMITS.nameMax),
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceDeviceId: options.device.id,
    sourceDeviceName: options.device.name.slice(0, SESSION_LIMITS.deviceNameMax),
    version: 1,
    windows: savedWindows,
  };
  return { session, report };
};
