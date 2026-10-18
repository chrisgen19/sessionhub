import { Cloud, CloudOff, LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { formatRelative, initials, plural } from "@/lib/format";
import type { ConnectionStatus } from "@/server/queries/dashboard";
import { ThemeToggle } from "@/components/theme-toggle";
import { BottomNav, SidebarNav } from "./nav-links";
import { SearchShortcut } from "./search-shortcut";
import { VerifyEmailBanner } from "./verify-email-banner";

interface AppShellProps {
  user: { name: string; email: string };
  /** Show the "confirm your email" banner (unconfirmed email and email delivery set up). */
  askToVerify: boolean;
  connection: ConnectionStatus;
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

function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-on-brand">
      {initials(name)}
    </span>
  );
}

/**
 * Connected browsers, never "Sync on" or "Sync off": sync is a setting of each browser's extension,
 * which the server doesn't know. The wording says where to change it, never what it is set to. "Last activity", never "online": there is no heartbeat.
 */
function ConnectionNote({ connection }: { connection: ConnectionStatus }) {
  const connected = connection.connectedBrowsers > 0;
  const Icon = connected ? Cloud : CloudOff;
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
        <Icon aria-hidden="true" className="size-3.5" />
        {connected ? `${plural(connection.connectedBrowsers, "browser")} connected` : "No browser connected"}
      </p>
      <p className="text-[11px] leading-relaxed text-fg-muted">
        {connected
          ? `${connection.lastSeenAt ? `Last activity: ${formatRelative(connection.lastSeenAt)}. ` : ""}Turn sync on or off in each browser's extension.`
          : "Sessions stay in the extension until you connect a browser and turn on sync there."}
      </p>
    </div>
  );
}

/**
 * Signed-in dashboard frame, laid out like the extension manager (docs/UI_UX_DESIGN.md 18n): a
 * sidebar with navigation, connection, theme and account; no top bar, so pages get the full
 * height. Narrower than 1024px: a slim header and a bottom tab bar instead.
 */
export function AppShell({ user, askToVerify, connection, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-canvas text-fg lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="hidden border-r border-line bg-surface px-3.5 py-6 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:gap-7">
        <div className="px-2">
          <Brand />
        </div>
        <SidebarNav />
        <div className="mt-auto space-y-4 border-t border-line px-2 pt-4">
          <ConnectionNote connection={connection} />
          <Link
            href="/app/settings"
            title={`${user.name} (${user.email})`}
            aria-label={`Account settings for ${user.name}`}
            className="flex min-w-0 items-center gap-2.5 rounded-lg hover:opacity-80"
          >
            <Avatar name={user.name} />
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold">{user.name}</span>
              <span className="block truncate text-[11px] text-fg-muted">{user.email}</span>
            </span>
          </Link>
          <div className="flex items-center justify-between gap-2">
            <ThemeToggle />
            <form action={signOutAction}>
              <button type="submit" className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-fg-muted hover:bg-surface-muted hover:text-fg">
                <LogOut aria-hidden="true" className="size-3.5" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col pb-16 lg:h-screen lg:pb-0">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 lg:hidden">
          <Brand />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/app/settings" title={`${user.name} (${user.email})`} aria-label={`Account settings for ${user.name}`}>
              <Avatar name={user.name} />
            </Link>
          </div>
        </header>
        {askToVerify && <VerifyEmailBanner email={user.email} />}
        {/* The scroll area from 1024px; `relative` keeps absolutely positioned sr-only text inside it. */}
        <main className="relative min-h-0 flex-1 lg:overflow-y-auto">{children}</main>
      </div>
      <SearchShortcut />
      <BottomNav />
    </div>
  );
}
