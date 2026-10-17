import { CloudOff, LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { initials } from "@/lib/format";
import { BottomNav, SidebarNav } from "./nav-links";
import { TopSearch } from "./top-search";

interface AppShellProps {
  user: { name: string; email: string };
  children: ReactNode;
}

function Brand() {
  return (
    <Link href="/app" className="flex items-center gap-2.5" aria-label="SessionHub overview">
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-[9px] bg-brand font-extrabold text-on-brand">
        S
      </span>
      <span className="text-[17px] font-bold tracking-tight">SessionHub</span>
    </Link>
  );
}

/** Signed-in dashboard frame (docs/UI_UX_DESIGN.md section 8 and 14). */
export function AppShell({ user, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-canvas text-fg lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="hidden border-r border-line bg-surface px-3.5 py-6 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:gap-7">
        <div className="px-2">
          <Brand />
        </div>
        <SidebarNav />
        <div className="mt-auto space-y-3 border-t border-line px-2 pt-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
            <CloudOff aria-hidden="true" className="size-3.5" />
            Sync off
          </p>
          <p className="text-[11px] leading-relaxed text-fg-muted">Cloud sync isn&apos;t available yet. Nothing has been uploaded.</p>
          <form action={signOutAction}>
            <button type="submit" className="flex items-center gap-2 text-xs font-semibold text-fg-muted hover:text-fg">
              <LogOut aria-hidden="true" className="size-3.5" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 pb-16 lg:pb-0">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:flex-nowrap lg:px-8">
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="order-last w-full lg:order-none lg:w-auto lg:flex-1">
            <TopSearch />
          </div>
          <Link
            href="/app/settings"
            title={`${user.name} (${user.email})`}
            aria-label={`Account settings for ${user.name}`}
            className="ml-auto grid size-8 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-on-brand"
          >
            {initials(user.name)}
          </Link>
        </header>
        <main className="mx-auto max-w-[1160px] px-4 py-6 sm:px-6 lg:px-9 lg:py-9">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
