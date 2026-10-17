import type { Notice } from "./notices";

const NOTICE_STYLE: Record<Notice["tone"], string> = {
  ok: "bg-brand-soft text-brand",
  error: "bg-danger-soft text-danger",
  conflict: "bg-warning-soft text-warning",
};

/** The outcome of a session write, in a polite live region; a conflict offers to load the latest version. */
export function NoticeLine({ notice, onLoadLatest }: { notice: Notice | null; onLoadLatest: () => void }) {
  return (
    <div aria-live="polite">
      {notice && (
        <p className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-[13px] ${NOTICE_STYLE[notice.tone]}`}>
          <span>{notice.text}</span>
          {notice.tone === "conflict" && (
            <button type="button" onClick={onLoadLatest} className="font-semibold underline">Load latest version</button>
          )}
        </p>
      )}
    </div>
  );
}
