import type { ReactNode } from "react";
import { AppShell } from "@/components/dashboard/app-shell";
import { isMailEnabled } from "@/server/mail/deliver";
import { requireSession } from "@/server/session";

/**
 * Shared signed-in frame. Each page also calls requireSession(): layouts don't re-run on
 * client-side navigation, so the layout check alone isn't an authorization boundary.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await requireSession();
  return (
    <AppShell user={{ name: user.name, email: user.email }} askToVerify={!user.emailVerified && isMailEnabled()}>
      {children}
    </AppShell>
  );
}
