import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import type { SavedSession } from "@sessionhub/contracts/session";
import { summarizeSession } from "@sessionhub/core/session-summary";
import { SessionSyncBadge } from "../../components/sync-status-chip";
import { buttonClass } from "../../components/modal";
import { formatFullDate, plural, sessionOrigin } from "../../lib/format";
import type { SessionSyncLabel } from "../../lib/sync-status";
import { useReviewItems } from "../../hooks/use-review";
import { OpenPanel } from "../open/open-panel";
import { ReviewDialog } from "../review/review-dialog";
import { WorkspacePicker } from "../workspaces/workspace-picker";
import { DeleteDialog } from "./delete-dialog";
import { LastRestore } from "./last-restore";
import { RenameTitle } from "./rename-title";
import { SessionActions } from "./session-actions";
import { SessionNotes } from "./session-notes";
import { SessionTags } from "./session-tags";
import { SiteSummary } from "./site-summary";

interface SessionInspectorProps {
  session: SavedSession;
  syncLabel: SessionSyncLabel;
  /** Its account workspace (null: none). */
  workspaceId: string | null;
  /** Every tag in use, offered when adding one. */
  allTags: string[];
  onBack: () => void;
  onDeleted: () => void;
  /** Opens another session (after a review that kept this browser's version as a new one). */
  onOpen: (id: string) => void;
  /** The list's search, for the open picker's "Select matches". */
  query?: string;
}

export function SessionInspector({ session, syncLabel, workspaceId, allTags, onBack, onDeleted, onOpen, query }: SessionInspectorProps) {
  const [dialog, setDialog] = useState<"delete" | "review" | null>(null);
  const review = useReviewItems()?.find((item) => item.sessionId === session.id);
  const summary = summarizeSession(session);

  return (
    <article aria-label="Session details">
      <header className="space-y-3 border-b border-line px-5 py-5 lg:px-8">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand xl:hidden">
          <ArrowLeft aria-hidden="true" className="size-4" />
          All sessions
        </button>
        <RenameTitle key={`${session.id}:${session.version}`} session={session} />
        {/* Five actions don't fit beside a title in the inspector's width, so they get their own row. */}
        <SessionActions session={session} onDuplicated={onOpen} onDelete={() => setDialog("delete")} />
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <span className="font-semibold tabular-nums">
              {plural(summary.windowCount, "window")} · {plural(summary.tabCount, "tab")}
            </span>
            <SessionSyncBadge label={syncLabel} />
            {session.isArchived && <span className="rounded-md bg-surface-muted px-2 py-0.5 font-semibold">Archived</span>}
            <span className="text-fg-muted">
              {sessionOrigin(session)} · saved {formatFullDate(session.updatedAt)} · version {session.version}
            </span>
          </div>
          <WorkspacePicker sessionId={session.id} inAccount={syncLabel !== "local"} workspaceId={workspaceId} />
          <SessionTags key={session.id} session={session} suggestions={allTags} />
          <SessionNotes key={`notes:${session.id}`} session={session} />
          <SiteSummary session={session} />
        </div>
      </header>

      <div className="space-y-4 px-5 py-5 lg:px-8">
        {review && (
          <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg bg-warning-soft px-3 py-2.5 text-xs text-fg">
            <span className="min-w-0 flex-1">
              <span className="font-semibold">Needs review.</span> Your account didn&apos;t accept the last change. Both versions are kept until you choose.
            </span>
            <button type="button" className={buttonClass.secondary} onClick={() => setDialog("review")}>
              Review…
            </button>
          </div>
        )}
        <LastRestore session={session} />
        <OpenPanel key={session.id} session={session} query={query} />
      </div>

      {dialog === "review" && review && (
        <ReviewDialog
          item={review}
          onClose={() => setDialog(null)}
          onResolved={(id) => {
            setDialog(null);
            if (id !== session.id) onOpen(id);
          }}
        />
      )}
      {dialog === "delete" && (
        <DeleteDialog
          session={session}
          inAccount={syncLabel !== "local"}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            onDeleted();
          }}
        />
      )}
    </article>
  );
}
