import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy policy · SessionHub" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-sm leading-7">
      <Link href="/" className="font-semibold text-brand">SessionHub home</Link>
      <h1 className="mt-6 text-3xl font-bold">Privacy policy</h1>
      <p className="mt-2 text-fg-muted">Updated October 17, 2026. Applies to the SessionHub Chrome extension and web app.</p>
      <p className="mt-4 rounded-lg border border-line p-4">
        SessionHub is a development preview. There is no public cloud deployment yet. Before opening a hosted service,
        its operator must publish a private support/deletion contact, hosting providers and backup retention here.
      </p>
      <h2 className="mt-8 text-lg font-semibold">What stays in your browser</h2>
      <p>SessionHub stores saved session names, tab titles and complete URLs, window/tab order, pinned state, tab groups,
        timestamps and device labels in the extension&apos;s IndexedDB. Automatic recovery checkpoints also capture normal
        browser windows as tabs change. They stay local, with a rolling limit of 50 checkpoints within seven days;
        safety rules retain the newest and largest recent checkpoint. Private/incognito windows and SessionHub&apos;s own pages are excluded.</p>
      <p>SessionHub does not read visited page contents, cookies, passwords, form input or Chrome browsing history.
        It does not run content scripts. Favicons use Chrome&apos;s favicon endpoint; SessionHub does not request third-party icon services.</p>
      <h2 className="mt-8 text-lg font-semibold">Optional account and sync</h2>
      <p>An account uses your name, email address and a password hash. Sign-in sessions store an IP address and user agent
        for account security. Pairing records your browser/device label and revocable credentials. Device credentials are
        stored in the extension, hashed on the server and excluded from session exports.</p>
      <p>Connecting a browser does not enable sync. Enabling it requires an upload preview and confirmation. Selected saved
        sessions move into the account; while sync is on, newly saved and imported sessions upload too. Uploaded data includes
        session names, tab titles, complete URLs, groups, order, pinned state, timestamps and device provenance. Account data
        and previous versions are stored on the server. Automatic recovery checkpoints never upload.</p>
      <p>URLs can contain private paths, search terms and access tokens. Site exclusions and query-parameter stripping are
        not implemented. The upload preview selects whole sessions, not individual URLs. Inspect and remove sensitive tabs
        before saving or uploading. Unsupported URLs can be saved and synced even though restore skips them.</p>
      <h2 className="mt-8 text-lg font-semibold">How information is used and shared</h2>
      <p>Information is used to save, search, restore and synchronize your sessions and secure your account. SessionHub has no
        advertising, analytics SDK or telemetry. It does not sell data, use it for advertising, lending or credit decisions,
        or permit unrelated human review. Server operators can access readable cloud data for support at your request,
        security, service operation or legal obligations. SessionHub is not end-to-end encrypted.</p>
      <p>Hosting and database operators necessarily process hosted data. If configured, Resend delivers confirmation and
        password-reset emails using your email address and a time-limited account link; tab lists are not sent to the mail
        provider. Development uses local Mailpit instead. Hosting providers have not yet been selected.</p>
      <p>SessionHub&apos;s use of information received from Chrome APIs follows the Chrome Web Store User Data Policy,
        including its Limited Use requirements.</p>
      <h2 className="mt-8 text-lg font-semibold">Retention, export and deletion</h2>
      <p>Saved local sessions remain until you delete them or clear/uninstall the extension. Uninstalling or clearing the
        browser profile removes local storage; it is not a backup. Exported JSON contains readable titles and URLs: protect
        exported files yourself. Restore job summaries retain up to 50 jobs within 30 days, with the newest and active jobs protected.</p>
      <p>Turning sync off stops subsequent transfers; a request already sent may finish. It does not erase server copies,
        cached account data or queued changes. Disconnecting removes the active device credentials and hides cached account
        records, which remain on disk and reappear when the same account reconnects. Revoking a device blocks future access
        but cannot erase copies already downloaded to it.</p>
      <p>Deleting a synced session creates a server tombstone. Historical versions, change records and operation receipts
        currently have no automatic purge; backups may retain deleted information. Account erasure requires an operator request;
        there is no self-service account deletion or full account export yet. You can export individual sessions from the extension or web app.</p>
      <h2 className="mt-8 text-lg font-semibold">Security and contact</h2>
      <p>Production connections require HTTPS. Server logs redact URLs, emails, credentials and session content. Infrastructure
        access logs and backup retention must be configured by the operator; no production retention or at-rest encryption is
        claimed before deployment verification.</p>
      <p>The preview is maintained by <a className="text-brand underline" href="https://github.com/chrisgen19">chrisgen19</a>.
        A private support and account-erasure contact must be added before public registration. Do not put private URLs,
        exports, passwords or tokens in public issues. Material policy changes will update this page and its date; new data
        uses must be disclosed before they begin.</p>
    </main>
  );
}
