"use client";

import { Layers, LayoutDashboard, MonitorSmartphone, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV_ITEMS = [
  { href: "/app", label: "Overview", icon: LayoutDashboard },
  { href: "/app/sessions", label: "Saved sessions", icon: Layers },
  { href: "/app/devices", label: "Devices", icon: MonitorSmartphone },
  { href: "/app/settings", label: "Settings", icon: Settings },
] as const;

const isCurrent = (pathname: string, href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

/** Sidebar navigation (desktop). */
export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard" className="grid gap-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const current = isCurrent(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-semibold ${
              current ? "bg-brand-soft text-brand" : "text-fg-muted hover:bg-surface-muted"
            }`}
          >
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Bottom tab bar (below 1024px). */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard" className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-line bg-surface lg:hidden">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const current = isCurrent(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold ${
              current ? "text-brand" : "text-fg-muted"
            }`}
          >
            <Icon aria-hidden="true" className="size-5" />
            <span className="truncate">{label === "Saved sessions" ? "Sessions" : label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
