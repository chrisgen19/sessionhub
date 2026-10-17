"use client";

import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import { Archive, ArchiveRestore, Download, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api-client";
import { plural } from "@/lib/format";
import { downloadSessionExport, openableUrls, openLinks } from "@/lib/session-files";
import { ConfirmDialog } from "./confirm-dialog";
import { NoticeLine } from "./notice-line";
import { RenameForm } from "./rename-form";
import { useSessionMutation } from "./use-session-mutation";

function ActionButton({ onClick, disabled, danger, children }: { onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-semibold disabled:opacity-50 ${
        danger ? "text-danger hover:bg-danger-soft" : "border border-line bg-surface hover:bg-surface-muted"
      }`}
    >
      {children}
    </button>
  );
}

/** Rename, archive, export, open and delete, all through /api/v1 with the version the page loaded. */
export function SessionActions({ detail }: { detail: ApiSessionDetail }) {
  const router = useRouter();
  const { pending, notice, setNotice, run, loadLatest } = useSessionMutation();
  const [renaming, setRenaming] = useState(false);
  const [dialog, setDialog] = useState<"delete" | "open" | null>(null);
  const links = openableUrls(detail);
  const path = `/api/v1/sessions/${detail.id}`;

  const toggleArchive = () =>
    void run(
      () => apiFetch<ApiSessionDetail>(path, "PATCH", { expectedVersion: detail.version, isArchived: !detail.isArchived }),
      (updated) => (updated.isArchived ? "Archived. It's hidden from your active sessions." : "Moved back to your active sessions."),
    );

  const remove = async () => {
    const ok = await run(() => apiFetch(`${path}?expectedVersion=${detail.version}`, "DELETE"), () => null);
    setDialog(null);
    if (ok) router.push("/app/sessions");
  };

  const open = () => {
    setDialog(null);
    const { opened, blocked } = openLinks(links);
    setNotice(
      blocked > 0
        ? { tone: "error", text: `Opened ${opened} of ${links.length}. Your browser blocked ${blocked}: allow pop-ups for this site, or open links one at a time below.` }
        : { tone: "ok", text: `Opened ${plural(opened, "link")} in new tabs.` },
    );
  };

  return (
    <section aria-label="Session actions" className="space-y-3">
      {renaming ? (
        <RenameForm detail={detail} pending={pending} run={run} onDone={() => setRenaming(false)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={() => setRenaming(true)} disabled={pending}><Pencil aria-hidden="true" className="size-4" />Rename</ActionButton>
          <ActionButton onClick={toggleArchive} disabled={pending}>
            {detail.isArchived ? <ArchiveRestore aria-hidden="true" className="size-4" /> : <Archive aria-hidden="true" className="size-4" />}
            {detail.isArchived ? "Unarchive" : "Archive"}
          </ActionButton>
          <ActionButton onClick={() => setNotice({ tone: "ok", text: `Downloaded ${downloadSessionExport(detail)}. Import it in the SessionHub extension to restore these tabs.` })}>
            <Download aria-hidden="true" className="size-4" />Export JSON
          </ActionButton>
          <ActionButton onClick={() => (links.length > 1 ? setDialog("open") : open())} disabled={links.length === 0}>
            <ExternalLink aria-hidden="true" className="size-4" />Open {plural(links.length, "link")}
          </ActionButton>
          <ActionButton danger onClick={() => setDialog("delete")} disabled={pending}><Trash2 aria-hidden="true" className="size-4" />Delete</ActionButton>
        </div>
      )}
      <NoticeLine notice={notice} onLoadLatest={loadLatest} />
      {dialog === "delete" && (
        <ConfirmDialog title={`Delete "${detail.name}"?`} confirmLabel="Delete session" tone="danger" busy={pending} onConfirm={() => void remove()} onClose={() => setDialog(null)}>
          <p>This removes the session and its {plural(detail.tabCount, "tab")} from your account. Browsers with sync on remove it at their next sync.</p>
          <p>Tabs you have open right now aren&apos;t affected, and neither are sessions kept only in a browser.</p>
        </ConfirmDialog>
      )}
      {dialog === "open" && (
        <ConfirmDialog title={`Open ${plural(links.length, "link")}?`} confirmLabel={`Open ${links.length} tabs`} onConfirm={open} onClose={() => setDialog(null)}>
          <p>This opens {plural(links.length, "new tab")} in this browser. Your browser may block some as pop-ups; you can allow pop-ups for this site.</p>
          <p>Browser pages, local files and unsafe links are skipped.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
