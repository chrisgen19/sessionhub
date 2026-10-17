import type { SavedSession } from "@sessionhub/contracts/session";
import { planRestore, type RestoreDestination } from "@sessionhub/core/restore-plan";
import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import { browser } from "wxt/browser";
import type { RestoreJobRecord } from "../../lib/db";
import { plural } from "../../lib/format";
import { sendCommand } from "../../lib/message-client";
import type { RestoreTarget } from "../../lib/messages";
import { readOpenTarget, readSkipOpen, saveOpenTarget, saveSkipOpen } from "../../lib/open-preferences";
import { allOpenable, canOpen, isEverything, matchingTabIds, reconcileSaved, type SavedSelection } from "../../lib/open-selection";
import { RestoreResult } from "../manager/restore-result";
import { OpenBar } from "./open-bar";
import { SavedTabTree } from "./saved-tab-tree";

/** Opening more tabs than this asks first (Session Buddy prompts on "a lot of tabs"). */
export const LARGE_OPEN_THRESHOLD = 50;

type Phase = { name: "idle" } | { name: "confirm" } | { name: "running" } | { name: "done"; job: RestoreJobRecord } | { name: "error"; message: string };

interface OpenPanelProps {
  session: SavedSession;
  /** A recovery checkpoint carries its snapshot in `session` (same id). */
  kind?: "session" | "snapshot";
  /** The list's search, for "Select matches". */
  query?: string;
}

/** Where the command sends the tabs; for this window, the window this page belongs to. */
const targetFor = async (destination: RestoreDestination, skipOpen: boolean): Promise<RestoreTarget> => {
  if (destination !== "this-window") return { kind: destination };
  const current = await browser.windows.getCurrent();
  if (current.id === undefined) throw new Error("Couldn't tell which window this is");
  return { kind: "this-window", windowId: current.id, skipOpen };
};

/**
 * The open picker (docs/UI_UX_DESIGN.md section 12 update): tick windows and tabs, pick where they
 * open, and open them. The ticked tree is the preview; only large opens ask first. Render with
 * `key={session.id}`: a new version of the same session keeps the selection.
 */
export function OpenPanel({ session, kind = "session", query = "" }: OpenPanelProps) {
  const [selection, setSelection] = useState<SavedSelection>(() => allOpenable(session));
  const [seenVersion, setSeenVersion] = useState(session.version);
  const [destination, setDestination] = useState(readOpenTarget);
  const [skipOpen, setSkipOpen] = useState(readSkipOpen);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [retrying, setRetrying] = useState(false);

  // A rename or a download changes the version: keep the ticks of tabs that are still there.
  if (session.version !== seenVersion) {
    setSeenVersion(session.version);
    setSelection(reconcileSaved(selection, session));
  }

  const plan = useMemo(
    () => planRestore(session, { tabIds: selection, layout: destination === "new-windows" ? "original" : "single" }),
    [session, selection, destination],
  );
  const total = allOpenable(session).size;
  const notOpenable = session.windows.reduce((sum, window) => sum + window.tabs.filter((tab) => !canOpen(tab)).length, 0);
  const matches = query.trim() ? matchingTabIds(session, query) : null;

  const start = async () => {
    setPhase({ name: "running" });
    try {
      const target = await targetFor(destination, skipOpen);
      const tabIds = isEverything(selection, session) ? {} : { tabIds: [...selection] };
      const response = await sendCommand(
        kind === "snapshot"
          ? { type: "recovery.restore", snapshotId: session.id, ...tabIds, target }
          : { type: "restore.start", sessionId: session.id, ...tabIds, target },
      );
      setPhase(response.ok ? { name: "done", job: response.data.job } : { name: "error", message: response.error.message });
    } catch (error) {
      setPhase({ name: "error", message: error instanceof Error ? error.message : "Couldn't open these tabs" });
    }
  };
  const barPhase = phase.name === "confirm" || phase.name === "running" ? phase.name : retrying ? "running" : "idle";

  return (
    <section aria-label="Open tabs" className="space-y-3">
      <div className="sticky top-0 z-10 rounded-xl border border-line bg-surface p-3 shadow-sm">
        <OpenBar
          ticked={{ tabs: selection.size, windows: session.windows.filter((window) => window.tabs.some((tab) => selection.has(tab.id))).length }}
          total={total}
          planned={{ tabs: plan.tabCount, windows: plan.windows.length }}
          destination={destination}
          onDestination={(next) => {
            setDestination(next);
            saveOpenTarget(next);
          }}
          skipOpen={skipOpen}
          onSkipOpen={(next) => {
            setSkipOpen(next);
            saveSkipOpen(next);
          }}
          matches={matches?.size ?? null}
          onSelectAll={() => setSelection(allOpenable(session))}
          onSelectNone={() => setSelection(new Set())}
          onSelectMatches={() => setSelection(matches ?? new Set())}
          phase={barPhase}
          onOpen={() => (plan.tabCount > LARGE_OPEN_THRESHOLD ? setPhase({ name: "confirm" }) : void start())}
          onConfirm={() => void start()}
          onCancel={() => setPhase({ name: "idle" })}
        />
      </div>

      {notOpenable > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          <AlertTriangle aria-hidden="true" className="mt-px size-4 shrink-0" />
          {plural(notOpenable, "tab")} can't be reopened (browser pages, local files or unsupported links). They're kept here for reference.
        </p>
      )}

      {phase.name === "done" && (
        <div className="rounded-xl border border-line px-4 pb-4">
          <RestoreResult
            session={session}
            job={phase.job}
            onJobUpdated={(job) => setPhase({ name: "done", job })}
            onBusyChange={setRetrying}
            onClose={() => setPhase({ name: "idle" })}
          />
        </div>
      )}
      {phase.name === "error" && (
        <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
          <span className="min-w-0 flex-1">Restore stopped: {phase.message}</span>
          <button type="button" className="text-xs font-semibold underline" onClick={() => setPhase({ name: "idle" })}>
            Dismiss
          </button>
        </p>
      )}

      <SavedTabTree session={session} selection={selection} onChange={setSelection} expandAll />
    </section>
  );
}
