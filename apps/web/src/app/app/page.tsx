import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/(auth)/actions";
import { getCurrentSession } from "@/server/session";

export const metadata: Metadata = { title: "Your account · SessionHub" };

/** Minimal signed-in page until the dashboard shell lands (next M3 item). */
export default async function AppHomePage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login?next=/app");

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-8">
      <h1 className="text-2xl font-bold tracking-tight">Signed in</h1>
      <p className="mt-2 text-sm text-fg-muted">
        {session.user.name} · {session.user.email}
      </p>
      <p className="mt-6 rounded-xl border border-line bg-surface p-4 text-[13px] text-fg-muted">
        Your synced saved sessions will appear here once cloud sync is available. Nothing has been uploaded from your browser.
      </p>
      <form action={signOutAction} className="mt-6">
        <button type="submit" className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3.5 text-[13px] font-semibold hover:bg-surface-muted">
          Sign out
        </button>
      </form>
    </main>
  );
}
