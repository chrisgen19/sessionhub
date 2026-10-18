import { ArrowLeft, BookmarkPlus, Check, Download, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { summarizeSession } from "@sessionhub/core/session-summary";
import { buttonClass } from "../../components/modal";
import { routeHref } from "../../hooks/use-manager-route";
import { useSyncOverview } from "../../hooks/use-sync";
import type { RecoverySnapshotRecord } from "../../lib/db";
import { downloadSessionExport } from "../../lib/export-download";
import { formatFullDate, plural } from "../../lib/format";
import { sendCommand } from "../../lib/message-client";
import { LastRestore } from "../manager/last-restore";
import { OpenPanel } from "../open/open-panel";
import { DESTINATION } from "../save/save-bar";

type SaveState =
  | { name: "idle" }
  | { name: "saving" }
  | { name: "saved"; sessionId: string; syncing: boolean }
  | { name: "error"; message: string };

const NOTE_TONE: Record<SaveState["name"], string> = {
  idle: "bg-surface-muted text-fg-muted",
  saving: "bg-surface-muted text-fg-muted",
  saved: "bg-brand-soft text-brand",
  error: "bg-danger-soft text-danger",
};

/** Mount with `key={snapshot.id}` so the save result never carries over to another checkpoint. */
export function CheckpointInspector({ snapshot, onBack }: { snapshot: RecoverySnapshotRecord; onBack: () => void }) {
  const summary = summarizeSession(snapshot.session);
  const [save, setSave] = useState<SaveState>({ name: "idle" });
  // Like the save picker: where the copy goes is stated, and known, before it can be saved.
  const overview = useSyncOverview();
  const destination = overview === null ? null : overview.kind === "on" ? "account" : "local";

  const saveAsSession = async () => {
    setSave({ name: "saving" });
    const response = await sendCommand({ type: "recovery.saveAsSession", snapshotId: snapshot.id });
    setSave(response.ok ? { name: "saved", ...response.data } : { name: "error", message: response.error.message });
  };

  return (
    <article aria-label="Checkpoint details">
      {/* Same header as a saved session's inspector: title and actions on one row, facts under it. */}
      <header className="space-y-3 border-b border-line px-5 py-5 lg:px-8">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand xl:hidden">
          <ArrowLeft aria-hidden="true" className="size-4" />
          All checkpoints
        </button>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <h2 className="min-w-0 flex-1 basis-[min(100%,20rem)] text-2xl font-bold tracking-tight break-words">{snapshot.session.name}</h2>
          <div className="flex shrink-0 flex-wrap gap-2">
            {/* Disabled once saved: another click would only add a second copy. */}
            <button
              type="button"
              className={buttonClass.secondary}
              disabled={destination === null || save.name === "saving" || save.name === "saved"}
              onClick={() => void saveAsSession()}
            >
              {save.name === "saving" ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : save.name === "saved" ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <BookmarkPlus aria-hidden="true" className="size-4" />
              )}
              {save.name === "saved" ? "Saved as session" : "Save as session"}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => downloadSessionExport(snapshot.session)}>
              <Download aria-hidden="true" className="size-4" />
              Export JSON
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <span className="font-semibold tabular-nums">
            {plural(summary.windowCount, "window")} · {plural(summary.tabCount, "tab")}
          </span>
          <span className="text-fg-muted">
            {snapshot.reason === "manual" ? "Taken manually" : "Saved automatically"} · {formatFullDate(snapshot.capturedAt)} · this browser only
          </span>
        </div>
      </header>
      <div className="space-y-4 px-5 py-5 lg:px-8">
        <LastRestore session={snapshot.session} />
        {/* The note turns into the save result in place; only the result is live, so the destination isn't announced on load. */}
        <p className={`rounded-lg px-3 py-2 text-xs ${NOTE_TONE[save.name]}`}>
          {(save.name === "idle" || save.name === "saving") && (
            <span>
              Checkpoints are replaced over time. To keep this one, save it as a session.{" "}
              {destination ? DESTINATION[destination] : "Checking where this saves…"}
            </span>
          )}
          <span aria-live="polite">
            {save.name === "saved" && (
              <>
                {save.syncing ? "Saved as a session. It will sync to your account." : "Saved locally as a session."}{" "}
                <a href={routeHref({ view: "sessions", sessionId: save.sessionId, workspace: null })} className="font-semibold underline">
                  View session
                </a>
              </>
            )}
            {save.name === "error" && `Not saved: ${save.message}`}
          </span>
        </p>
        <OpenPanel key={snapshot.id} session={snapshot.session} kind="snapshot" />
      </div>
    </article>
  );
}
