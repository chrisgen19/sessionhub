import { CircleUser, History, Layers } from "lucide-react";
import type { ReactNode } from "react";
import { BrandMark } from "../../components/brand";
import { SyncNote, SyncStatusChip } from "../../components/sync-status-chip";
import { routeHref, useManagerRoute, type ManagerRoute } from "../../hooks/use-manager-route";
import { AccountView } from "../account/account-view";
import { RecoveryView } from "../recovery/recovery-view";
import { SessionsView } from "./sessions-view";

function NavLink({ route, current, icon, children }: { route: ManagerRoute; current: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <a
      href={routeHref(route)}
      aria-current={current ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-semibold lg:py-2.5 ${
        current ? "bg-brand-soft text-brand" : "text-fg-muted hover:bg-surface-muted"
      }`}
    >
      {icon}
      {children}
    </a>
  );
}

/** Full-page manager shell: navigation plus the Saved sessions or Recovery view. */
export function ManagerApp() {
  const [route, navigate] = useManagerRoute();

  return (
    <div className="min-h-screen bg-canvas text-fg lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="flex flex-wrap items-center justify-between gap-y-2 border-b border-line bg-surface px-4 py-3 lg:sticky lg:top-0 lg:h-screen lg:flex-col lg:flex-nowrap lg:items-stretch lg:justify-start lg:gap-7 lg:border-r lg:border-b-0 lg:px-3.5 lg:py-6">
        <div className="flex items-center gap-2.5 lg:px-2">
          <BrandMark />
          <span className="text-[17px] font-bold tracking-tight">SessionHub</span>
        </div>
        <nav aria-label="Manager" className="order-last flex w-full gap-1 lg:order-none lg:flex-col">
          <NavLink route={{ view: "sessions", sessionId: null }} current={route.view === "sessions"} icon={<Layers aria-hidden="true" className="size-4" />}>
            Saved sessions
          </NavLink>
          <NavLink route={{ view: "recovery", snapshotId: null }} current={route.view === "recovery"} icon={<History aria-hidden="true" className="size-4" />}>
            Recovery
          </NavLink>
          <NavLink route={{ view: "account" }} current={route.view === "account"} icon={<CircleUser aria-hidden="true" className="size-4" />}>
            Account
          </NavLink>
        </nav>
        <div className="lg:mt-auto lg:space-y-2 lg:border-t lg:border-line lg:px-2 lg:pt-4">
          <SyncStatusChip />
          <SyncNote />
        </div>
      </aside>

      {route.view === "account" ? (
        <AccountView />
      ) : route.view === "recovery" ? (
        <RecoveryView snapshotId={route.snapshotId} onSelect={(snapshotId) => navigate({ view: "recovery", snapshotId })} />
      ) : (
        <SessionsView sessionId={route.sessionId} onSelect={(sessionId) => navigate({ view: "sessions", sessionId })} />
      )}
    </div>
  );
}
