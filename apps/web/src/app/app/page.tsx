import { Layers } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, StatTile, SyncNotice } from "@/components/dashboard/page-parts";
import { SessionList } from "@/components/dashboard/session-list";
import { getPrisma } from "@sessionhub/database/client";
import { getOverviewStats, listSessions } from "@/server/queries/dashboard";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Overview · SessionHub" };

export default async function OverviewPage() {
  const { user } = await requireSession("/app");
  const prisma = getPrisma();
  const [stats, recent] = await Promise.all([getOverviewStats(prisma, user.id), listSessions(prisma, user.id, { take: 5 })]);
  const firstName = user.name.split(/\s+/)[0] ?? user.name;

  return (
    <>
      <PageHeader title={`Welcome, ${firstName}`} description="Your saved sessions and devices, across browsers." />
      <SyncNotice />
      <section aria-label="Summary" className="mb-8 grid gap-3 sm:grid-cols-3">
        <StatTile label="Saved sessions" value={stats.sessionCount} foot="Synced to your account" />
        <StatTile label="Saved tabs" value={stats.tabCount} foot="Across synced sessions" />
        <StatTile label="Devices" value={stats.deviceCount} foot="Connected browsers" />
      </section>
      <section aria-labelledby="recent-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="recent-heading" className="text-sm font-semibold">
            Recent saved sessions
          </h2>
          {recent.length > 0 && (
            <Link href="/app/sessions" className="text-xs font-semibold text-brand hover:underline">
              View all
            </Link>
          )}
        </div>
        {recent.length > 0 ? (
          <SessionList sessions={recent} />
        ) : (
          <EmptyState icon={Layers} title="No synced sessions yet">
            Save sessions with the SessionHub extension. They&apos;ll show up here after you turn on sync, which isn&apos;t available yet.
          </EmptyState>
        )}
      </section>
    </>
  );
}
