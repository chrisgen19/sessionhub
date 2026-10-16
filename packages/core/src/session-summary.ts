import type { SavedSession } from "@sessionhub/contracts/session";

export interface SessionSummary {
  windowCount: number;
  tabCount: number;
  restorableTabCount: number;
}

export const summarizeSession = (session: SavedSession): SessionSummary => {
  const tabs = session.windows.flatMap((window) => window.tabs);
  return {
    windowCount: session.windows.length,
    tabCount: tabs.length,
    restorableTabCount: tabs.filter((tab) => tab.eligibility === "restorable").length,
  };
};
