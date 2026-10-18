import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import { Info } from "lucide-react";
import { formatRelativeInline, plural } from "@/lib/format";
import type { WorkspaceChoice } from "@/server/queries/dashboard";
import { SessionHeader } from "./session-header";
import { SessionTags } from "./session-tags";
import { WindowTree } from "./window-tree";
import { WorkspaceSelect } from "./workspace-select";

interface SessionDetailProps {
  detail: ApiSessionDetail;
  workspaces: WorkspaceChoice[];
  /** The list it was opened from, with its filters. */
  listHref: string;
}

/** An open session beside the list: title and actions, facts, workspace, tags and notes, then its windows and tabs. */
export function SessionDetail({ detail, workspaces, listHref }: SessionDetailProps) {
  return (
    <article aria-label="Session details">
      <SessionHeader detail={detail} listHref={listHref}>
        <p className="text-xs text-fg-muted">
          From {detail.sourceDeviceName || "an unknown device"} · {plural(detail.windowCount, "window")} · {plural(detail.tabCount, "tab")} · updated{" "}
          {formatRelativeInline(new Date(detail.updatedAt))} · version {detail.version}
        </p>
        <WorkspaceSelect detail={detail} workspaces={workspaces} />
        {detail.tags.length > 0 && <SessionTags tags={detail.tags} />}
        {detail.description && <p className="text-[13px] break-words whitespace-pre-wrap">{detail.description}</p>}
      </SessionHeader>
      <div className="space-y-4 px-5 py-5 lg:px-8">
        <p className="flex items-start gap-2 text-xs text-fg-muted">
          <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>
            To reopen these tabs as browser windows, export the JSON and import it in the SessionHub extension&apos;s manager. The website
            can&apos;t open or change windows in your browser.
          </span>
        </p>
        <WindowTree windows={detail.windows} />
      </div>
    </article>
  );
}
