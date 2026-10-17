import type { ReviewItem } from "../../lib/review-repository";
import { diffVersions } from "../../lib/review-text";
import { formatFullDate, plural } from "../../lib/format";

function Side({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="min-w-0 rounded-lg border border-line p-3">
      <p className="text-xs font-semibold text-fg-muted">{title}</p>
      {lines.map((line) => (
        <p key={line} className="mt-1 truncate text-[13px]" title={line}>
          {line}
        </p>
      ))}
    </div>
  );
}

function Links({ label, urls, total }: { label: string; urls: string[]; total: number }) {
  if (total === 0) return null;
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold">
        {plural(total, "link")} {label}
      </p>
      <ul className="mt-1 space-y-0.5">
        {urls.map((url) => (
          <li key={url} className="truncate font-mono text-[11px] text-fg-muted" title={url}>
            {url}
          </li>
        ))}
        {total > urls.length && <li className="text-[11px] text-fg-muted">and {total - urls.length} more</li>}
      </ul>
    </div>
  );
}

/** This browser's version next to the other one: names, counts, when, and which links differ. Links are text, never opened. */
export function ReviewCompare({ item }: { item: ReviewItem }) {
  const { local, server } = item;
  const mine = local
    ? [local.name, `${plural(local.windows.reduce((sum, w) => sum + w.tabs.length, 0), "tab")} in ${plural(local.windows.length, "window")}`, `Changed ${formatFullDate(local.updatedAt)}`]
    : ["Deleted in this browser"];
  const theirs = server
    ? [server.name, `${plural(server.tabCount, "tab")} in ${plural(server.windowCount, "window")}`, `Changed ${formatFullDate(server.updatedAt)}`, `From ${server.sourceDeviceName}`]
    : item.serverDeleted || item.kind === "deleted-on-server"
      ? ["Deleted elsewhere"]
      : ["Not downloaded yet. Sync now to compare."];
  const diff = local && server ? diffVersions(local.windows, server.windows) : null;
  return (
    <div className="mt-4 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Side title="This browser" lines={mine} />
        <Side title="Other version" lines={theirs} />
      </div>
      {diff && (diff.onlyHereCount > 0 || diff.onlyThereCount > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Links label="only here" urls={diff.onlyHere} total={diff.onlyHereCount} />
          <Links label="only in the other version" urls={diff.onlyThere} total={diff.onlyThereCount} />
        </div>
      )}
    </div>
  );
}
