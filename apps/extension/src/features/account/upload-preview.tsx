import { useState } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { summarizeSession } from "@sessionhub/core/session-summary";
import { DialogActions, Modal, buttonClass } from "../../components/modal";
import { API_ORIGIN } from "../../lib/api-config";
import { plural } from "../../lib/format";

/** What turning sync on uploads (docs/SECURITY_PRIVACY.md section 2), limited to features that exist. */
export const SYNC_DISCLOSURE = `When sync is on, the names of your saved sessions, the titles and links of their tabs, and each window's size, position and state are uploaded to your account on ${new URL(API_ORIGIN).host}, so you can open them on your other computers. Sessions you save from now on sync automatically. Recovery checkpoints are never uploaded. You can turn sync off at any time.`;

interface UploadPreviewProps {
  mode: "enable" | "upload";
  /** Sessions saved only in this browser. */
  sessions: SavedSession[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (sessionIds: string[]) => void;
}

/**
 * Shows exactly what would upload before anything does (docs/USER_FLOWS.md Flow 1). Every local
 * session starts ticked (user's choice); chosen sessions move into the account.
 */
export function UploadPreview({ mode, sessions, busy, error, onCancel, onConfirm }: UploadPreviewProps) {
  const [selected, setSelected] = useState(() => new Set(sessions.map((session) => session.id)));
  const chosen = sessions.filter((session) => selected.has(session.id));
  const tabs = chosen.reduce((sum, session) => sum + summarizeSession(session).tabCount, 0);
  const all = chosen.length === sessions.length;
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const count = plural(chosen.length, "session");
  const confirmText = mode === "upload" ? `Upload ${count}` : chosen.length > 0 ? `Turn on sync and upload ${count}` : "Turn on sync";

  return (
    <Modal title={mode === "enable" ? "Turn on sync" : "Upload sessions"} onClose={onCancel} dismissible={!busy}>
      {mode === "enable" && <p className="text-[13px] leading-relaxed text-fg-muted">{SYNC_DISCLOSURE}</p>}
      {sessions.length === 0 ? (
        <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2.5 text-[13px]">No sessions are saved only in this browser, so nothing else is uploaded now.</p>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold tabular-nums">
              {count} · {plural(tabs, "tab")} selected
            </span>
            <button type="button" className="font-semibold text-brand hover:underline" onClick={() => setSelected(new Set(all ? [] : sessions.map((session) => session.id)))}>
              {all ? "Select none" : "Select all"}
            </button>
          </div>
          <ul aria-label="Sessions to upload" className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {sessions.map((session) => (
              <li key={session.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] hover:bg-surface-muted">
                  <input type="checkbox" className="size-4 accent-brand" checked={selected.has(session.id)} onChange={() => toggle(session.id)} />
                  <span className="min-w-0 flex-1 truncate font-medium" title={session.name}>
                    {session.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-fg-muted">{plural(summarizeSession(session).tabCount, "tab")}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-fg-muted">
            Uploaded sessions move to your account: they appear in your other connected browsers, and are hidden here while this browser is
            disconnected. Tabs that can&apos;t be reopened (browser pages, local files) are uploaded as reference too. Unticked sessions stay in
            this browser only.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
      <DialogActions>
        <button type="button" autoFocus className={buttonClass.secondary} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={buttonClass.primary} onClick={() => onConfirm(chosen.map((session) => session.id))} disabled={busy || (mode === "upload" && chosen.length === 0)}>
          {confirmText}
        </button>
      </DialogActions>
    </Modal>
  );
}
