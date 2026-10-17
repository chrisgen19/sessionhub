import { CloudOff, LoaderCircle, RefreshCw, Upload } from "lucide-react";
import { useState } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { buttonClass } from "../../components/modal";
import { OverviewChip } from "../../components/sync-status-chip";
import { useSyncActions, useSyncOverview } from "../../hooks/use-sync";
import { formatFullDate, plural } from "../../lib/format";
import { UploadPreview } from "./upload-preview";

/** Sync opt-in, status and actions for a connected browser (docs/UI_UX_DESIGN.md section 13). */
export function SyncSection({ localSessions }: { localSessions: SavedSession[] }) {
  const overview = useSyncOverview();
  const { busy, message, enable, disable, now } = useSyncActions();
  const [preview, setPreview] = useState<"enable" | "upload" | null>(null);
  if (!overview || overview.kind === "local-only") return null;

  const confirm = async (sessionIds: string[]) => {
    if (await enable(sessionIds)) setPreview(null);
  };
  const spinner = <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />;

  return (
    <section aria-labelledby="sync-heading" className="max-w-xl space-y-4 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="sync-heading" className="text-base font-semibold">
          Sync
        </h2>
        <OverviewChip overview={overview} />
      </div>
      {overview.kind === "sync-off" ? (
        <>
          <p className="text-[13px] leading-relaxed text-fg-muted">
            Sync is off. Nothing is uploaded or downloaded. Turn it on to see your saved sessions on your other computers; you&apos;ll see
            exactly what uploads first.
          </p>
          <button type="button" className={buttonClass.primary} onClick={() => setPreview("enable")}>
            Turn on sync…
          </button>
        </>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="text-fg-muted">Last synced</dt>
            <dd className="font-medium">{overview.lastSyncAt ? formatFullDate(overview.lastSyncAt) : "Not yet"}</dd>
            {overview.waiting > 0 && (
              <>
                <dt className="text-fg-muted">Waiting</dt>
                <dd className="font-medium">{plural(overview.waiting, "change")}</dd>
              </>
            )}
            {overview.review > 0 && (
              <>
                <dt className="text-fg-muted">Needs review</dt>
                <dd className="font-medium text-warning">{plural(overview.review, "change")} the server didn&apos;t accept. They&apos;re kept here.</dd>
              </>
            )}
          </dl>
          {overview.lastError && (
            <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-fg">
              {overview.lastError}
              {overview.nextAttemptAt && ` It will try again at ${formatFullDate(overview.nextAttemptAt)}.`} Saving and restoring still work.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass.primary} disabled={busy !== null} onClick={() => void now()}>
              {busy === "now" ? spinner : <RefreshCw aria-hidden="true" className="size-4" />} Sync now
            </button>
            {overview.localSessions > 0 && (
              <button type="button" className={buttonClass.secondary} disabled={busy !== null} onClick={() => setPreview("upload")}>
                <Upload aria-hidden="true" className="size-4" /> Upload sessions from this browser ({overview.localSessions})
              </button>
            )}
            <button type="button" className={buttonClass.ghostDanger} disabled={busy !== null} onClick={() => void disable()}>
              {busy === "disable" ? spinner : <CloudOff aria-hidden="true" className="size-4" />} Turn off sync
            </button>
          </div>
        </>
      )}
      <div aria-live="polite">{message && <p className={`text-[13px] ${message.tone === "ok" ? "text-brand" : "text-danger"}`}>{message.text}</p>}</div>
      {preview && (
        <UploadPreview
          mode={preview}
          sessions={localSessions}
          busy={busy === "enable"}
          error={message?.tone === "error" && busy === null ? message.text : null}
          onCancel={() => setPreview(null)}
          onConfirm={(ids) => void confirm(ids)}
        />
      )}
    </section>
  );
}
