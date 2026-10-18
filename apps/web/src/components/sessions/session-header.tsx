"use client";

import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import { Archive, ArchiveRestore, ArrowLeft, Download, ExternalLink, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
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

interface SessionHeaderProps {
  detail: ApiSessionDetail;
  /** The list this session was opened from (its view, workspace and search): the back link, and where Delete returns. */
  listHref: string;
  /** Facts and the workspace picker, under the title. */
  children: ReactNode;
}

/**
 * The session's title (h1) and its own actions on one row, as in the extension's inspector:
 * rename, export, open links, archive and delete, all through /api/v1 with the version the page loaded.
 */
export function SessionHeader({ detail, listHref, children }: SessionHeaderProps) {
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
    if (ok) router.push(listHref);
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
    <header className="space-y-3 border-b border-line px-5 py-5 lg:px-8">
      <Link href={listHref} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand xl:hidden">
        <ArrowLeft aria-hidden="true" className="size-4" />
        All sessions
      </Link>
      {/* Title and actions share a row; the actions wrap under a long title or on narrow screens. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        {/*
          The title stays while renaming: after a conflict it shows the latest name from the server
          next to the user's own edit, which the form keeps.
        */}
        <div className="min-w-0 flex-1 basis-[min(100%,20rem)] space-y-3">
          <div className="flex items-start gap-1.5">
            <h1 className="flex min-w-0 flex-wrap items-center gap-2 text-2xl font-bold tracking-tight break-words">
              {detail.name}
              {detail.isPinned && <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand">Pinned</span>}
              {detail.isArchived && <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-fg-muted">Archived</span>}
            </h1>
            {!renaming && (
              <button
                type="button"
                aria-label="Rename"
                title="Rename"
                disabled={pending}
                onClick={() => setRenaming(true)}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-surface-muted disabled:opacity-50"
              >
                <Pencil aria-hidden="true" className="size-4" />
              </button>
            )}
          </div>
          {renaming && <RenameForm detail={detail} pending={pending} run={run} onDone={() => setRenaming(false)} />}
        </div>
        {/* max-w-full: on a phone the buttons wrap instead of sizing the row to all of them. */}
        <div className="flex max-w-full flex-wrap gap-2">
          <ActionButton onClick={() => setNotice({ tone: "ok", text: `Downloaded ${downloadSessionExport(detail)}. Import it in the SessionHub extension to restore these tabs.` })}>
            <Download aria-hidden="true" className="size-4" />Export JSON
          </ActionButton>
          <ActionButton onClick={() => (links.length > 1 ? setDialog("open") : open())} disabled={links.length === 0}>
            <ExternalLink aria-hidden="true" className="size-4" />Open {plural(links.length, "link")}
          </ActionButton>
          <ActionButton onClick={toggleArchive} disabled={pending}>
            {detail.isArchived ? <ArchiveRestore aria-hidden="true" className="size-4" /> : <Archive aria-hidden="true" className="size-4" />}
            {detail.isArchived ? "Unarchive" : "Archive"}
          </ActionButton>
          <ActionButton danger onClick={() => setDialog("delete")} disabled={pending}><Trash2 aria-hidden="true" className="size-4" />Delete</ActionButton>
        </div>
      </div>
      {children}
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
    </header>
  );
}
