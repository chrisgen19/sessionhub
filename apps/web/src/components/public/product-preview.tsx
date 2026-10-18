import { Pin } from "lucide-react";
import { ColorDot } from "@/components/dashboard/color-dot";
import { SiteMark } from "@/components/sessions/site-mark";
import { GROUP_COLORS } from "@/lib/group-colors";

const SESSIONS = [
  { name: "Frontend research", detail: "21 tabs", workspace: { name: "Client Alpha", color: "blue" as const }, when: "2m ago" },
  { name: "Project docs", detail: "9 tabs", workspace: { name: "Client Alpha", color: "blue" as const }, when: "1h ago" },
  { name: "Reading list", detail: "5 tabs", workspace: { name: "Personal", color: "green" as const }, when: "Yesterday" },
  { name: "Window, Oct 16, 8:02 PM", detail: "11 tabs", workspace: null, when: "Last week" },
];

const PINNED = { title: "Pull request #42: restore window bounds", url: "https://github.com/acme/portal/pull/42", pinned: true };
const GROUPED = [
  { title: "The Secret Life of Objects", url: "https://eloquentjavascript.net/06_object.html" },
  { title: "grid-template-columns - CSS", url: "https://developer.mozilla.org/docs/Web/CSS/grid-template-columns" },
  { title: "Typography in design", url: "https://www.figma.com/resource-library/typography-in-design/" },
];
const LOOSE = [
  { title: "React Performance tracks", url: "https://react.dev/reference/dev-tools/react-performance-tracks" },
  { title: "Container queries", url: "https://tailwindcss.com/docs/responsive-design" },
  { title: "Layouts and Pages", url: "https://nextjs.org/docs/app/getting-started/layouts-and-pages" },
];

const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");

function TabLine({ title, url, pinned }: { title: string; url: string; pinned?: boolean }) {
  return (
    <li className="flex items-center gap-2.5 px-3 py-1.5">
      <SiteMark url={url} />
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{title}</span>
      {pinned && <Pin aria-hidden="true" className="size-3 shrink-0 text-fg-muted" />}
      <span className="hidden w-[34%] shrink-0 truncate text-[11px] text-fg-muted @lg:block">{host(url)}</span>
    </li>
  );
}

/**
 * The landing page's hero: SessionHub's Saved sessions as they look, built from the dashboard's
 * pieces (site marks, workspace dots, the list rail) with sample data. A picture, not a control:
 * one image to assistive technology, and nothing in it can be focused or clicked. `inert` is on
 * its content only: on the image itself it would hide the image and its description (PR #49 review).
 */
export function ProductPreview() {
  return (
    <div className="@container min-w-0">
      <div
        role="img"
        aria-label="SessionHub's Saved sessions: a list of saved sessions beside one session's windows, tab group and tabs."
        className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm select-none"
      >
        <div inert className="grid @xl:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
          <div className="hidden border-r border-line @xl:block">
            <p className="border-b border-line px-3.5 py-3 text-[13px] font-bold">Saved sessions</p>
            <ul className="divide-y divide-line">
              {SESSIONS.map((session, index) => (
                <li key={session.name} className={`space-y-0.5 px-3.5 py-2.5 ${index === 0 ? "bg-brand-soft shadow-[inset_3px_0_0_var(--sh-brand)]" : ""}`}>
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{session.name}</span>
                    <span className="shrink-0 text-[10px] text-fg-muted">{session.when}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-fg-muted">
                    {session.workspace && (
                      <>
                        <ColorDot color={session.workspace.color} />
                        <span className="truncate">{session.workspace.name}</span>
                        <span>·</span>
                      </>
                    )}
                    <span className="shrink-0">{session.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            <div className="border-b border-line px-4 py-3.5">
              <p className="truncate text-[15px] font-bold tracking-tight">Frontend research</p>
              <p className="mt-0.5 text-[11px] text-fg-muted">2 windows · 21 tabs · Client Alpha</p>
            </div>
            <div className="p-3">
              <div className="overflow-hidden rounded-lg border border-line bg-canvas">
                <p className="border-b border-line px-3 py-1.5 text-[11px] font-semibold">
                  Window 1 <span className="font-normal text-fg-muted">· 15 tabs</span>
                </p>
                <ul>
                  <TabLine {...PINNED} />
                </ul>
                <p className="flex items-center gap-2 px-3 pt-1.5 text-[11px] font-semibold">
                  <span className="size-2 rounded-full" style={{ backgroundColor: GROUP_COLORS.blue }} />
                  Research <span className="font-normal text-fg-muted">(3)</span>
                </p>
                <ul className="ml-4 border-l border-line">
                  {GROUPED.map((tab) => (
                    <TabLine key={tab.url} {...tab} />
                  ))}
                </ul>
                <ul>
                  {LOOSE.map((tab) => (
                    <TabLine key={tab.url} {...tab} />
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
