import type { Metadata } from "next";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { PageHeader } from "@/components/dashboard/page-parts";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Settings · SessionHub" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${title}-heading`} className="rounded-xl border border-line bg-surface p-5">
      <h2 id={`${title}-heading`} className="text-sm font-semibold">
        {title}
      </h2>
      <div className="mt-3 space-y-2 text-[13px] text-fg-muted">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const { user } = await requireSession("/app/settings");
  const memberSince = user.createdAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <>
      <PageHeader title="Settings" description="Your account, sync and privacy." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Account">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt>Name</dt>
            <dd className="truncate font-medium text-fg">{user.name}</dd>
            <dt>Email</dt>
            <dd className="truncate font-medium text-fg">{user.email}</dd>
            <dt>Member since</dt>
            <dd className="font-medium text-fg">{memberSince}</dd>
          </dl>
        </Section>
        <Section title="Sync">
          <p>
            <span className="font-semibold text-fg">Off.</span> Cloud sync isn&apos;t available yet, so nothing from your browsers is
            stored on this account.
          </p>
          <p>When it arrives, sync is opt-in per browser and you&apos;ll see which titles and links are uploaded before anything is sent.</p>
        </Section>
        <Section title="Privacy">
          <p>Automatic recovery checkpoints stay on each computer and are never uploaded.</p>
          <p>SessionHub doesn&apos;t offer end-to-end encryption, so synced data will be readable by the server operator.</p>
        </Section>
        <Section title="Security">
          <p>Signing out ends this browser&apos;s session. It doesn&apos;t affect the extension or other devices.</p>
          <form action={signOutAction}>
            <button
              type="submit"
              className="mt-1 inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3.5 text-[13px] font-semibold text-fg hover:bg-surface-muted"
            >
              Sign out
            </button>
          </form>
        </Section>
      </div>
    </>
  );
}
