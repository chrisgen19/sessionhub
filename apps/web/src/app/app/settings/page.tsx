import type { Metadata } from "next";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { ResendVerificationButton } from "@/components/auth/resend-verification-button";
import { PageBody, PageHeader } from "@/components/dashboard/page-parts";
import { getPrisma } from "@sessionhub/database/client";
import { plural } from "@/lib/format";
import { isMailEnabled } from "@/server/mail/deliver";
import { getConnectionStatus } from "@/server/queries/dashboard";
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
  const { connectedBrowsers } = await getConnectionStatus(getPrisma(), user.id);
  const memberSince = user.createdAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <PageBody>
      <PageHeader title="Settings" description="Your account, sync and privacy." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Account">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt>Name</dt>
            <dd className="truncate font-medium text-fg">{user.name}</dd>
            <dt>Email</dt>
            <dd className="truncate font-medium text-fg">{user.email}</dd>
            <dt>Email status</dt>
            <dd className="font-medium text-fg">
              {user.emailVerified ? (
                "Confirmed"
              ) : (
                <>
                  Not confirmed{isMailEnabled() && <>. <ResendVerificationButton email={user.email} /></>}
                </>
              )}
            </dd>
            <dt>Member since</dt>
            <dd className="font-medium text-fg">{memberSince}</dd>
          </dl>
        </Section>
        <Section title="Sync">
          <p>
            <span className="font-semibold text-fg">
              {connectedBrowsers > 0 ? `${plural(connectedBrowsers, "browser")} connected.` : "No browser connected."}
            </span>{" "}
            Turn sync on or off in each browser&apos;s SessionHub extension (Account, then Sync). Before anything uploads, it shows which
            titles and links will be sent. Manage connected browsers on the Devices page.
          </p>
        </Section>
        <Section title="Privacy">
          <p>Automatic recovery checkpoints stay on each computer and are never uploaded.</p>
          <p>SessionHub doesn&apos;t offer end-to-end encryption, so synced data is readable by the server operator.</p>
        </Section>
        <Section title="Security">
          <ChangePasswordForm />
          <p className="border-t border-line pt-3">Signing out ends this browser&apos;s session. It doesn&apos;t affect the extension or other devices.</p>
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
    </PageBody>
  );
}
