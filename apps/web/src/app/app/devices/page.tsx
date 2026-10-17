import { MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/dashboard/page-parts";
import { getPrisma } from "@sessionhub/database/client";
import { formatRelative } from "@/lib/format";
import { listDevices } from "@/server/queries/dashboard";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Devices · SessionHub" };

export default async function DevicesPage() {
  const { user } = await requireSession("/app/devices");
  const devices = await listDevices(getPrisma(), user.id);
  const now = new Date();

  return (
    <>
      <PageHeader title="Devices" description="Your devices are browser installations connected to this account." />
      {devices.length === 0 ? (
        <EmptyState icon={MonitorSmartphone} title="No devices connected yet">
          Devices appear here after you connect the SessionHub extension to this account. Connecting the extension isn&apos;t
          available yet; the extension works on its own in the meantime.
        </EmptyState>
      ) : (
        <ul aria-label="Devices" className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {devices.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold">{device.displayName}</p>
                <p className="text-xs text-fg-muted">
                  {[device.browser, device.platform].filter(Boolean).join(" · ") || "Browser"} ·{" "}
                  {/* "Last seen", never "online": there is no heartbeat (UI_UX_DESIGN.md section 8). */}
                  {device.lastSeenAt ? `last seen ${formatRelative(device.lastSeenAt, now).toLowerCase()}` : "not seen yet"}
                </p>
              </div>
              {device.revokedAt && (
                <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-fg-muted">Access revoked</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs leading-relaxed text-fg-muted">
        Revoking a device (coming with sync) blocks new cloud access. It never erases sessions already saved on that computer.
      </p>
    </>
  );
}
