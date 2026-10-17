# Release and rollback

Status: M6 repository preparation; no public deployment or Chrome Web Store submission yet. M5 remains separate. Do not call this a production release until the open gates below have evidence.

## Candidate

1. Use a clean short branch from `main`, review migration changes and dependency advisories (`pnpm audit --prod`). Resolve exploitable findings or document reviewed exceptions; never silently waive the scan.
2. Run `pnpm install --frozen-lockfile`, `pnpm check --force`, the web database tests, `pnpm build`, `pnpm test:e2e`, `pnpm test:docker`, the encrypted backup test and `pnpm test:perf` as described in TEST_PLAN. Database package tests use a disposable database and a destructive reset; web tests use non-destructive migrate deploy. Do not reset a shared database.
3. Build the extension with `WXT_API_BASE_URL=https://<actual-origin> pnpm --filter @sessionhub/extension zip:release`. Both builds must be byte-identical, with packaged 16/32/48/128 icons, MV3, the explicit CSP, exactly four permissions and exactly one host. `.invalid` is CI validation only. Review source for remote code, dynamic execution, external message handlers and client/server dependency boundaries; automated checks do not prove all store policies.
4. Keep a private release record: commit, lockfile hash, extension version, ZIP SHA-256, exact API origin, immutable `runner`/`migrate` image digests, migration list, PostgreSQL major, test output and pending limitations. Store release artifacts beyond CI's 30-day retention. Never rebuild an old tag against a different origin and call it the same artifact.
5. On each store upload raise `apps/extension/package.json` version. Use a staging candidate first and the exact tested artifact. Retain the previous extension/source and server images. Store listing/disclosures are prepared in STORE_LISTING.md; screenshots must show the current build with synthetic data.

## Deploy and promote

Complete DEPLOYMENT and BACKUPS on the actual host: HTTPS redirect/certificate/HSTS/cookie checks, spoofed-forwarded-header rate limits, no public app/DB ports, real Resend email, off-host backup download and a full staging restore. Set the operator/private support contact, providers and actual backup retention in `/privacy`; test the public page without signing in. Confirm store dashboard disclosures and reviewer access. No placeholder origin or missing contact in a public release.

Take a fresh encrypted off-host backup before migration. Run `prisma migrate deploy` once through the migrate image, then start the matching web image; readiness must be 200 with PostgreSQL reachable. Verify existing account sign-in, old session reads/exports and paired-device sync before broadening traffic. Publish the extension only after its configured API is healthy and compatible with older installed extensions. Chrome updates cannot be assumed simultaneous.

## Rollback

- **Application only:** stop promotion/traffic if needed, select the recorded previous immutable image in Coolify, and redeploy only if its code remains compatible with the current schema and API. Keep database and runtime secrets. Check readiness/auth/session reads and sync before reopening traffic.
- **Migrations:** production migrations only move forward. Never run `prisma migrate reset`, edit an applied migration or point old code at an incompatible schema. Prefer expand/contract changes: additive migration, compatible code, backfill, and removal in a later release. If a migration failed, preserve logs and inspect database state; `migrate resolve` is an operator repair after an explicit reviewed plan, not an automatic retry.
- **Database restore:** a last resort using BACKUPS disaster recovery, into a new target. Preserve the old volume; pause sync and reconcile clocks/receipts/client outboxes before accepting writes. A database restore is not an ordinary image rollback.
- **Extension:** the store does not downgrade installations. Fix by uploading a new, higher version containing the corrected/previous compatible code. For developer profiles, export sessions before changing builds; do not uninstall or clear IndexedDB as a rollback step. Keep schema upgrades backward compatible or provide an export/recovery path. Never direct users to delete local sessions to recover a release.
- **Credential incident:** revoke affected devices using the existing Devices controls; preserve local sessions. If mass revocation or key rotation is needed, block traffic and use a reviewed server-only operator transaction. There is no automated incident CLI. Do not log or commit credentials.

## Known limitations

- Desktop Chrome preview. Chromium E2E runs on this machine/CI; a manual stable-Chrome pass on Windows and macOS and store review are still needed. Minimum Chrome 104 is a manifest floor, not evidence every version has been tested.
- No side panel/live-tab navigation, workspace extension UI, tags/bulk tools, mobile/accessibility audit or large library virtualization (M5).
- No per-site exclusion/query stripping. Whole-session upload preview; complete selected URLs can include secrets. Unsupported schemes are retained but skipped on restore. No end-to-end encryption or production at-rest encryption claim.
- No self-service account deletion/full account export; server tombstones, historical versions, changes and receipts are not automatically purged. Operator contact and retention must be finalized before registration opens.
- Recovery checkpoints stay local; browser profile loss/uninstall removes them. Use independent JSON exports.
- If a worker dies after Chrome opens a tab but before its outcome commits, retry may duplicate that one unrecorded tab. Pin/group metadata are best effort; a failed pin no longer causes retry to reopen an otherwise successful window.
- A refused edit kept locally without a downloaded server copy can retain the account id and hide its server version. `LIMIT_REACHED` receipt retries need a new operation; the current UI has no dedicated retry after freeing server capacity. Preserve/export those sessions and review rather than clearing queues.
- Logs are redacted stdout/stderr only, with no configured shipper/alerts. Production provider, mail delivery, backup jobs/retention and RPO/RTO remain unverified until deployment.
- No automated signing/store upload or production promotion. CI artifacts alone are not long-term release storage.

## Launch gates still pending

Real host/domain and repository origin variable; private support/deletion contact and providers/retention; actual off-host restore plus staging application recovery; TLS/proxy/firewall/migration checks; real Resend email; final screenshots/reviewer account/store submission; Windows/macOS stable Chrome smoke and final policy review. Track evidence in PROGRESS/ROADMAP and issue #5 without checking unverified boxes.
