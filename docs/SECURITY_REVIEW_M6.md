# M6 security and release review — 2026-10-17

Scope: issue #5; branch `feature/m6-release-hardening`, based on `1b9dd50`. This is a repository review and local test pass, not a penetration-test certification or a production audit. Live deployment gates remain in RELEASE.md.

## Boundaries reviewed

- Extension manifest: exactly `tabs`, `tabGroups`, `favicon`, `alarms`; one API host; MV3 service worker; no content scripts/external messaging/optional permissions/web-accessible resources. Explicit CSP permits packaged scripts/objects only. ZIP checker verifies permission/host equality, packaged icon headers/dimensions, background origin, no dev fallback, maps or remote HTML scripts; both builds match byte-for-byte.
- Background commands require this extension's sender id and page URL, then a shared Zod command schema. Pull/reconciliation has no browser actions. Restore is additive with an in-extension preview. No database/server credentials are in extension imports.
- Local account scope and upload gate are tested, including disabling consent or switching account mid-run. No site exclusions or query stripping are claimed: all non-empty saved URLs, including unsupported schemes, may upload if selected. The public privacy page and store disclosures say so.
- Database/HTTP tests cover ownership, untrusted bodies, CSRF/origin, bounded requests, shared rate limits, forwarded IP spoofing, refresh reuse/concurrency, idempotency and version races. Restore failure tests preserve successful opens before cosmetic pinning/grouping; the pin failure duplication bug is fixed.
- Server logs use the central redactor. Reviewed extension/background/sync and web component sources contain no console logging of URLs, bodies or credentials. No telemetry SDK was found. Infrastructure proxy logging/retention still needs deployment review. Emailed reset/verification links intentionally contain one-time tokens; never promise no token-bearing URLs anywhere.
- Backup uses authenticated age encryption, never writes a host plaintext dump, refuses overwrites and fails on pipeline errors. Disposable isolated restores test the actual migration schema and all public-table data with hashes. Corruption and failed source dump do not produce accepted backups. Off-host transfer/key recovery and staging application recovery remain pending.

## Production dependency advisory triage

`pnpm audit --prod --json` reported **2 high + 1 moderate**, no critical. These are present in the lockfile; the scan is **not clean**. No override or global advisory suppression was added. Reviewed reachability exceptions below apply only to this PostgreSQL configuration and must be revisited before release and by **2026-11-17**, or immediately on adapter/configuration changes. Prefer upstream compatible dependency updates; forcing a major transitive override without compatibility testing is not a fix.

| Advisory | Installed / fix | Reachability evidence and disposition |
|---|---|---|
| [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), high, recursive object merge exhaustion | `deepmerge-ts` 7.1.5 / >=8.0.0 | Pulled by `@prisma/config`, which merges operator-owned Prisma configuration. Exploit requires recursive object graphs; plain HTTP JSON cannot form these cycles. Source config accepts no request objects. Next's generated `*.nft.json` traces contain no `deepmerge-ts` files. Retained in migration/build tooling; deferred to an upstream compatible Prisma update. |
| [GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr), high, MySQL authentication downgrade | `mysql2` 3.15.3 / >=3.22.0 | Optional Prisma/Better Auth MySQL dependency. This repo uses only `PrismaPg` and Better Auth `provider: "postgresql"`; request data cannot select a database driver/DSN. No MySQL imports or connections in app code, and no mysql2 files in standalone traces. Retain until upstream update; review if MySQL is ever enabled. |
| [GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3), moderate, compressed MySQL protocol exhaustion | `mysql2` 3.15.3 / >=3.23.1 | Same unused MySQL path. No compressed MySQL connection exists in this application. Same upstream-update follow-up. |

These exceptions document current exposure; they do not certify the dependencies safe for other uses. Preserve the audit output privately with the candidate's evidence and rerun against current advisories before promotion. The Docker migration image installs Prisma tooling and therefore retains the tooling dependency; keep migration configuration/SQL and operator access trusted.

## Remaining review gates

Production TLS/trusted proxy/firewall/cookies and real email; deployed provider/access-log/backup retention; private contact and account erasure procedure; independent off-host restore and key recovery; stable Chrome on Windows/macOS; final store dashboard categories and policy review. No actual public service or store approval exists. Known product/recovery limitations are in RELEASE.md.
