import type { Metadata } from "next";
import { ConnectedBrowsers, RecentSessions, WorkspaceSummary } from "@/components/dashboard/overview-parts";
import { PageBody, PageHeader, SyncNotice } from "@/components/dashboard/page-parts";
import { getPrisma } from "@sessionhub/database/client";
import { plural } from "@/lib/format";
import { getOverviewStats, listDevices, listSessions, listWorkspaceFilters } from "@/server/queries/dashboard";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Overview · SessionHub" };

/**
 * What to act on (docs/UI_UX_DESIGN.md 18n): the latest sessions, connected browsers and workspaces,
 * with setup steps while no browser is connected. The totals are one line, not number tiles.
 */
export default async function OverviewPage() {
  const { user } = await requireSession("/app");
  const prisma = getPrisma();
  const [stats, recent, devices, filters] = await Promise.all([
    getOverviewStats(prisma, user.id),
    listSessions(prisma, user.id, { take: 6 }),
    listDevices(prisma, user.id),
    listWorkspaceFilters(prisma, user.id),
  ]);
  const firstName = user.name.split(/\s+/)[0] ?? user.name;
  const workspaces = new Map(filters.workspaces.map((workspace) => [workspace.id, workspace]));

  return (
    <PageBody>
      <PageHeader
        title={`Welcome, ${firstName}`}
        description={
          <span className="tabular-nums">
            {plural(stats.sessionCount, "saved session")} · {plural(stats.tabCount, "tab")} · {plural(stats.deviceCount, "connected browser")}
          </span>
        }
      />
      {stats.deviceCount === 0 && <SyncNotice />}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <RecentSessions sessions={recent} workspaces={workspaces} />
        <div className="space-y-6">
          <ConnectedBrowsers devices={devices.filter((device) => !device.revokedAt)} />
          <WorkspaceSummary filters={filters} />
        </div>
      </div>
    </PageBody>
  );
}
