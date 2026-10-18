# SessionHub — Security & Privacy Design

**Status:** Initial threat model; requires a real code audit before release.  
**Updated:** 2026-10-16.

## 1. Why browser-session data is sensitive

A session can include private document URLs, unguessable share links, access tokens in query strings, internal company hostnames, personal interests, and login-related redirect parameters. Titles and URL paths can also be sensitive. Even without page contents or cookies, saved tab metadata must be treated as private user data.

## 2. Default product policy

- Session capture/storage is **local-first** and works signed out.
- Cloud synchronization defaults to **off**. User must affirmatively consent after being told tab titles and URLs can be uploaded.
- Incognito capture/sync is **off** by default, and should remain out of MVP unless separately designed and disclosed.
- No cookies, passwords, keystrokes, page content, request bodies, browsing-history surveillance, or third-party ad trackers.
- Recovery snapshots remain **local-only** by default. Saved sessions/workspaces may sync after consent.
- A saved session holds only the tabs the user ticked in the save picker, and the picker says before saving whether it stays in this browser or uploads to the account. Browser pages are opt-in (unticked by default). Only tab ids cross from the page to the worker, which reads titles and URLs from Chrome itself (2026-10-17, UI_UX_DESIGN.md 18i).
- Provide account export, disconnect/revoke, and cloud deletion workflows.
- Publish an accurate privacy policy and extension permission rationale before Chrome Web Store submission.

### Suggested onboarding disclosure copy

> SessionHub saves the titles and links of tabs you choose to capture so you can restore them later. Your sessions are saved on this browser by default. If you enable cloud sync, saved session names, your notes and tags, titles, URLs, each window's size, position and state, and workspace information will be uploaded to your account so you can access them on other devices. You can disable sync. Site exclusions and query stripping are not available in this preview; inspect selected sessions for sensitive URLs before uploading.

Do not make the privacy disclosure conditional on reading a lengthy policy. Users must understand the substance in the UI.

## 3. Browser URL classification

Treat URLs as untrusted inputs and apply a versioned classifier to capture/export/sync/restore operations.

| URL category | Default decision | Reason |
|---|---|---|
| `https:` and `http:` regular pages | Eligible, subject to exclusions/redaction | Core session feature |
| `chrome:` / `chrome-extension:` / `devtools:` / browser internal | Metadata only or excluded; do not promise restoration | Browser and permissions restrictions |
| `file:` | Excluded from cloud by default; local restore only after permissions/support validation | Local path disclosure |
| `about:` / `data:` / `javascript:` | Not restorable/synced by default | Security/compatibility |
| Internal/private hostnames or localhost | User-configurable exclusion; consider safe default prompt for work data | Potential sensitive development/internal URLs |
| URL contains known credential-like query params | Redact/remove or exclude before upload | Access token leakage |

The app must display which items were skipped during capture/restore and allow manual per-site exclusion. Do not claim regex-based redaction catches every secret; it is defense-in-depth, not a guarantee.

## 4. Threat model

| Threat | Impact | Proposed mitigation |
|---|---|---|
| User A accesses User B sessions via changed ID | Private browsing exposure | Resource ownership check in every query/action, authz tests |
| Stolen/replayed device credential | Unauthorized sync | Scoped revocable tokens, short-lived access, rotation, device revoke, log review |
| Website sends extension a destructive external message | Browser tab disruption | Exact allowlisted origins, validated intent, user gesture, in-extension confirmation |
| MV3 worker termination mid-write | Data loss/corruption | IndexedDB transactions, durable outbox, retry-safe operations |
| Concurrent clients overwrite each other | Session loss | Version checks, immutable revisions, recoverable conflict copies |
| Imported JSON contains untrusted HTML/URLs | XSS or unsafe navigation | Zod structural validation, text rendering, safe URL allowlists, CSP |
| Logs leak private tab URLs/tokens | Privacy breach | Structured redaction, limited fields, access control and retention |
| Malicious extension/user impersonation | Account takeover | Explicit extension IDs/trusted origins, validated device pairing, no wildcard prod origins |
| Lost/stolen computer with signed-in extension | Disclosure of local sessions/cloud data | Device revocation, OS disk encryption guidance, token lifecycle limits |
| Compromised admin/server | Cloud data exposure | Least privilege, encrypted transport/storage, incident plan; no false E2EE claims |
| Account switch on one Chrome profile | Cross-account local cache leak | Account-scoped IndexedDB records and outbox separation |
| Extension update/IndexedDB migration failure | Recovery loss | Versioned schema, migration tests, export fallback, backups |
| Database backup inaccessible or untested | Catastrophic backend loss | Off-host encrypted backups and periodic restore drills |

## 5. Auth and device controls

- Better Auth is web auth; validate compatible version/adapter/CSRF flow.
- Distinct `Device` record per installation/browser profile.
- Evaluate web sign-in and one-time pairing using PKCE/state or verified browser extension identity flow.
- Auth authorization codes must be short-lived, single-use, bound to proper context; do not leak long-lived credentials in URLs.
- Extension IDs in allowlists must be explicit in production; do not use `chrome-extension://*` trusted origins.
- Store device credentials in the least-exposed persistent context supported by Chrome; consider `chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})` where applicable, rotate refresh tokens and limit lifetimes. Avoid exporting tokens in backups.
- Account/device revocation enforced on every authenticated device request, not inferred solely from a client-sent ID.
- Signing out removes/revokes cloud credentials but does not erase user-created local data without explicit consent.

### 5a. Implemented extension pairing and device credentials (verified 2026-10-16)

Design chosen with the user: an RFC 8628-style device flow with SessionHub's own device credentials (Better Auth's `device-authorization` plugin was not used: its token is a full web session that can call `/api/auth/*` and isn't bound to the `Device` row).

1. The extension (Account view, user click) sends `POST /api/v1/pairing` with only its random installation id, a device name ("Chrome on Windows"), browser and platform. It receives a secret **device code** (stored only in the extension) and a **user code** `XXXX-XXXX` (20 consonants, 8 characters, about 2.6e10 combinations). The request lives 10 minutes.
2. The extension opens `/app/pair?code=XXXX-XXXX` in a normal tab. The page requires a signed-in session (cookie) and, when this server can send email, a **confirmed email**. It shows the device name and the code and asks the user to compare it with the extension. Approving or declining is a same-origin `POST /api/v1/pairing/decision` (Origin check, write rate limit); the API also enforces the email rule, not just the page.
3. The extension polls `POST /api/v1/pairing/token` every 5 seconds (faster polls get 429). After approval it receives credentials **once**; the pairing is then `redeemed` and any further poll is 410.
4. Credentials: a 15-minute **access token** and a 30-day **refresh token** (`shd_at_` / `shd_rt_` prefixes, 32 random bytes). The server stores only SHA-256 hashes. Every bearer request is checked against the database: unknown or rotated token -> 401 `INVALID_TOKEN`; device revoked or re-paired since issue (`auth_credential_version` mismatch) -> 401 `DEVICE_REVOKED`; expired -> 401 `ACCESS_TOKEN_EXPIRED`. Responses carry `WWW-Authenticate: Bearer error="invalid_token"`. Bearer endpoints never accept the web session cookie, and cookie endpoints never accept bearer tokens.
5. Refresh rotates both tokens and kills the old access token. Presenting an already-rotated refresh token **revokes the device**, with one exception: if its replacement has never been used (the extension lost the response, e.g. the worker was killed), the old token may be retried once and the unused replacement dies. The check and the claim of the unused replacement are one conditional update, so the retry and a concurrent first use of the replacement can't both succeed, and a second retry is treated as reuse. The extension serializes refreshes so it never races itself into a revoke.
6. Revocation (web Devices page "Disconnect", the extension's own Disconnect, or refresh reuse) sets `revoked_at`, bumps `auth_credential_version` and writes an `audit_events` row (`device_revoked` with the reason; `device_paired` on approval). Pairing again from the same installation reuses the device row, clears the revocation and issues fresh credentials; all older ones stay dead.
7. Extension storage: tokens are kept in the extension's own IndexedDB (`account` table). Web pages can't read it (there are no content scripts and no `externally_connectable`), it is never included in exports, and disconnecting deletes it while keeping every saved session. `chrome.storage.local` with `TRUSTED_CONTEXTS` would need the `storage` permission and wouldn't add protection here, because no untrusted context exists in this extension.
8. Local account isolation (2026-10-16, `DATA_MODEL.md` section 4): cached account data and queued uploads are scoped by the account id the server returned at pairing. Only the connected account's are visible or editable; signing into another account hides them (nothing is deleted or sent under the new account). The stored account id never changes: if `/devices/me` ever reports a different id, the extension disconnects instead of merging. This browser's own (`local`) sessions are never moved into an account automatically; that needs the user's choice in the upload preview (later slice).
9. Sync upload (2026-10-16, `SYNC_PROTOCOL.md` 13f): `POST /api/v1/sync/push` accepts only a device Bearer token, requires the body's `deviceId` to match it, a confirmed email (when email is enabled) and one write token per operation. The extension uploads only for the connected account and only when `syncState.enabledAt` (local consent) is set for it; nothing sets it until the opt-in slice, so no session data leaves a browser today. Server logs carry error class names only, never payloads or URLs (8a).
10. Sync download (2026-10-16, `SYNC_PROTOCOL.md` 13g): pull and bootstrap need the device Bearer token and a confirmed email; cursors are HMAC-bound to the account, so a cursor from another account is refused (queries are user-scoped regardless). Downloaded data lands only in the connected account's scope, never over this browser's own sessions or another account's cache, and a pull never touches tabs (two-profile E2E). Same local consent gate as uploads.
8. Rate limits: pairing start 5 per client IP, then 1 per minute; token polls and refreshes 30 per IP, then 1 every 2 seconds; the decision and disconnect calls share the account's write budget.

Not covered yet: account switching on one profile (the extension refuses a second pairing while connected; local data is still `local` scope), sync itself (M4 next slices), shared rate-limit storage across instances.

### Implemented web auth (verified 2026-10-16)

- Better Auth 1.7.9 email/password. Passwords are stored hashed by Better Auth (verified: the `account.password` value never contains the plaintext; algorithm is Better Auth's default and was not separately audited).
- Session cookie is `HttpOnly`, `SameSite=Lax` (verified in E2E). `Secure` is expected when served over HTTPS in production: **not verified yet** (no HTTPS deployment).
- Sign-in/sign-up go through Better Auth's HTTP endpoints, so its rate limiter and origin checks apply: 3 attempts per window per client IP, then 429 and "Too many attempts" (verified). Server-side `auth.api.*` calls skip the rate limiter and must not be used for credential checks.
- **Client IP (since 2026-10-17, section 8b):** the limiter keys on the address the trusted proxy recorded, never on what a client writes into `X-Forwarded-For`. Requests without a usable address share one bucket. Limits are stored in PostgreSQL, shared by all instances.
- Post-login redirects only accept same-site relative paths. Server logs record only the error class for failed sign-in/up, never emails, passwords or bodies; Better Auth's own messages (e.g. "Invalid password") go through the redacting logger without their arguments (8a).
- Dashboard authorization: a forged session cookie passes the optimistic proxy but is rejected by the per-page database check (verified in E2E). All dashboard queries filter by the session's user id; seeded data for a second user never appears in lists, counts or search (verified in DB and E2E tests). Soft-deleted and archived sessions are excluded.
- `/api/v1/sessions` (verified in DB and HTTP E2E tests): requests without a session get 401; another user's session id returns 404 for read, update and delete with nothing written (no change-log row, no clock row); creating with another user's id returns 409 without details. Writes require `Origin` = app origin (CSRF defense for cookie auth), JSON content type, at most 2 MB (checked before parsing) and reject unknown fields such as `userId`. Errors never echo internals; unexpected failures log the error class only. `/api/v1` writes and reads are rate-limited per user (writes 30 burst then 1/s, reads 120 burst then 2/s; 429 + `Retry-After`; verified in HTTP E2E, including that rejected anonymous and cross-origin requests don't consume the budget). Since 2026-10-16 every limit, Better Auth's sign-in and reset limits included, is stored in PostgreSQL and enforced across all web instances (`SYNC_PROTOCOL.md` 13a). Per-IP limits count the address the trusted proxy recorded (8b).
- `/api/v1/workspaces` and `/api/v1/devices` (verified in DB and HTTP E2E tests): same 401/403/415/413/rate-limit gate as sessions; another user's workspace or device id is a 404 with nothing written; unknown fields such as `userId` are rejected; workspace `icon` only accepts a short `[a-z0-9-]` key, so it can't carry markup or a URL. Device responses omit the installation id. Revoking a device increments `auth_credential_version` exactly once, which M4 device credentials must check on every request.
- Saved links in the web app: every URL is re-classified at render time; only http(s) becomes a link (`rel="noopener noreferrer"`), everything else (javascript:, data:, chrome:, file:) is plain text. "Open links" nulls `window.opener` on each new tab. `/app/*` responses send `Referrer-Policy: no-referrer`, so opened sites never learn the session page URL. Tab titles render as text. All verified in E2E (including an HTML/script title and a `javascript:` URL stored as "restorable").
- Password reset (verified in E2E against Mailpit): "Forgot password?" always answers "If there's an account for X, we've sent it a link", and no email is sent to unknown addresses. Emails are queued with Next.js `after()` and never awaited, so the response doesn't wait on the provider (Better Auth already simulates the token lookup for unknown emails). Reset links are single-use and expire after 1 hour; a used or forged token shows "This link doesn't work anymore" and changes nothing. A reset revokes **every** session of the account (other browsers are signed out) and sends a "password was changed" notice. `/reset-password` (token in the URL) sends `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. Better Auth limits reset and verification requests to 3 per minute per client IP.
- Email confirmation: a link is sent at sign-up (valid 24 hours; resend from the dashboard banner or Settings). An unconfirmed email does **not** block sign-in, because accounts are optional and only hold cloud data; cloud sync and device pairing (M4) must require a confirmed email. Emailed links always point at our own pages: the server overwrites any client-supplied `callbackURL`.
- Change password (Settings) needs the current password and signs out all other browsers.
- Mail delivery logs only the transport name and HTTP status on failure, never the recipient, link or token. The Resend API key is server-only (`RESEND_API_KEY`); `MAIL_TRANSPORT` defaults to `disabled`, in which case the reset page says email isn't set up instead of pretending to send.
- Known trade-offs: sign-up says when an email is already registered (account enumeration; accepted for MVP); `BETTER_AUTH_SECRET` must be at least 32 characters and is validated at first use; the Resend transport is unit-tested against its documented API but has **not** been tested against the live service (needs the operator's key and verified domain).

## 6. Extension permissions (minimum viable proposal)

Permissions must be justified by features that are **actually shipped**. Proposed candidates:

| Permission | Why it might be needed |
|---|---|
| `tabs` | Read title/URL/favicon for tab capture/search across browser windows |
| `tabGroups` | Capture and restore tab-group metadata |
| `storage` | Store small extension preferences/state |
| `alarms` | Schedule bounded recovery snapshots and sync retry |
| `sidePanel` | Offer Chrome side-panel interface |
| `host_permissions` limited to API origin | Send HTTPS requests to your own backend |
| `identity` (conditional) | Only if selected auth implementation needs Chrome identity flows |

**Shipped as of 2026-10-16** (`apps/extension/wxt.config.ts`): `tabs`, `tabGroups`, `favicon`, `alarms` (debounced recovery checkpoints), plus **one host permission** for the configured SessionHub server (`WXT_API_BASE_URL`, https required except localhost; used for pairing and opt-in sync). No other host permissions, no `storage`, `sidePanel`, `identity`, content scripts or `externally_connectable`. `favicon` lets pages show Chrome's cached favicon via `chrome-extension://<id>/_favicon/` so no third-party icon URL is requested. Add the others only together with the feature that needs them. Since 2026-10-17, CI fails the release ZIP if its permissions differ from this list, if `host_permissions` is anything but the configured https origin, or if content scripts, `externally_connectable`, `web_accessible_resources` or optional permissions appear (`apps/extension/scripts/check-release-zip.ts`, `DEPLOYMENT.md` section 6).

Recovery checkpoints contain only tab URLs, titles, pinned state and groups of normal windows, plus each window's state, position and size (2026-10-18); they stay in local IndexedDB and are never uploaded. Incognito windows are filtered out on capture (`apps/extension/src/lib/browser-capture.ts`), and the manifest does not request incognito access.

Window position and size (2026-10-18) need no new permission: they come from `chrome.windows`, and keeping a reopened window on screen relies on Chrome refusing bounds less than half on a screen, then opening at Chrome's default placement. `system.display` (screen sizes) would close the remaining gap, a window more than half on screen opening partly off it, but is not requested without a separate decision.

`chrome.windows` is an API namespace, not necessarily an extra manifest permission. Do not request `history`, `<all_urls>` host access, `cookies`, `webRequest`, or `scripting` without a feature-specific justification and privacy review. Chrome policy requires the narrowest necessary permissions.

## 7. Web ↔ extension communication security

Chrome supports controlled web-to-extension messaging via `externally_connectable` and `runtime.onMessageExternal`. If implemented:

1. Restrict manifest `externally_connectable.matches` to the exact production web origin (and explicit development origins in dev builds).
2. Check sender origin and message schema, size, supported command, nonce/state, and session association.
3. Do not treat page claims about user identity as authoritative; verify server tokens/pairing.
4. Restrict external messages to navigation/open-preview/pairing, not direct bulk close/restore.
5. Require visible in-extension confirmation before tabs are created.
6. Return bounded responses; never expose arbitrary local browsing lists to any matched web page without a deliberate authenticated user action.
7. Audit the website for XSS: an allowed origin is not inherently trustworthy if its page is compromised.

If this bridge isn't robust, omit it from MVP and use the extension's own manager to restore cloud sessions.

## 8. Backend hardening

- HTTPS-only production origin; secure proxy forwarded headers and cookie settings.
- Parameterized Prisma queries and safe raw SQL only where necessary.
- Validate Zod schema, max lengths/nesting/depth, batches and request-body size.
- Access control by authenticated `userId`; don't trust URL user IDs or `deviceId` strings.
- Auth and sync endpoint rate limits; use appropriate IP/device/account signals without privacy-invasive tracking.
- Strong CSP for the extension, no arbitrary remote JavaScript execution.
- Never expose Prisma/admin DB connection strings or Better Auth secrets to client builds.
- Limit server logs; audit security-relevant activity without raw tab URLs.

### 8b. Implemented trusted proxy and TLS requirements (2026-10-17)

Operator steps and checks are in `DEPLOYMENT.md`.

- **Client IP:**
  - Each proxy appends to `X-Forwarded-For`, so the app takes the entry `TRUSTED_PROXY_COUNT` places from the right (default 1: Coolify's Traefik) and ignores the client-written part to its left (`apps/web/src/server/client-ip.ts`). The old code took the leftmost entry, so a client could pick its own per-IP bucket for pairing start and device tokens.
  - Better Auth gets only the resolved address. Before, a multi-entry header made it fall back to one bucket shared by all such requests.
  - IPv6 counts by /64 network.
  - Verified in E2E, including that the same tests fail against the old code.
- **IP addresses stored:** Better Auth records the client address and user agent on each web sign-in session (`session.ipAddress`, `session.userAgent`). The address is now the resolved one rather than a client-written value. It is never logged.
- **HTTPS required in production:**
  - `BETTER_AUTH_URL` must be `https://` unless the host is loopback. Otherwise `/api/health` answers 503 and every auth and API request fails, so a misconfigured deployment never turns healthy.
  - With an https URL, Better Auth's cookies are `__Secure-` prefixed and `Secure` (verified against the standalone build).
  - The production build sends `Strict-Transport-Security: max-age=31536000`: this host only, no preload.
  - The extension build already refuses non-localhost http API origins.
- **Framing (clickjacking), since 2026-10-17:**
  - Every response, pages and API alike, carries `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`, in every environment (`apps/web/next.config.ts`).
  - Nothing embeds this app, so no frame is allowed, not even from this site. Otherwise a framed `/app/pair` could trick a signed-in user into clicking "Connect this browser" for an attacker's pending device.
  - The session cookie is `SameSite=Lax`, so a frame on another site never had the session and would only have shown the login page. The real gaps were framing from the same site (another subdomain, or a page on this origin) and visual tricks on the login page; both are closed now.
  - Verified in E2E (`e2e/framing.spec.ts`): the headers are on pages and API responses. Framed by a page on the same origin, with the session cookie sent, `/app/pair` ends on Chrome's error page instead of the approve page. Before the change it rendered.

### 8a. Implemented observability and resource limits (2026-10-17)

- **Structured logs** (`apps/web/src/server/observability/`): one JSON object per line, info on stdout, warn and error on stderr. Fields: `time`, `level`, `event`, `requestId`, then event fields.
- **Redaction happens in the logger**, so no call site can bypass it:
  - in every string field, URLs (any scheme), email addresses, `shd_*` tokens and `Bearer` values are replaced with placeholders
  - fields whose names suggest content or secrets (authorization, cookie, token, password, url, link, email, title, name, body, query, cursor, ...) are dropped
  - text is capped at 300 characters
- **Request ids:** every `/api/v1` and `/api/auth` request gets an `X-Request-Id`. A proxy's id is kept if it matches `^[A-Za-z0-9._-]{8,128}$` and contains no device credential prefix (`shd_at_`, `shd_rt_`, `shd_dc_`), otherwise a fresh UUID is used. The id is returned on the response and attached to every log line written during the request (AsyncLocalStorage).
- **Access log:** one `http_request` line per request with `method`, `path` (ids, tokens and numbers replaced with `:id`, query and fragment dropped), `status` and `durationMs`. Never the user, IP address, query, headers or body.
- **Errors and other events:**
  - unexpected errors log only the class, plus Prisma's `P####` code when present
  - mail failures log the provider and redacted message
  - Better Auth's own messages go through the same logger (`auth_log`, arguments by type only)
  - `/api/health` isn't logged
- **Verified:**
  - unit tests (redaction, paths, ids, immutable redirect responses, error classes)
  - an E2E for request ids
  - a run of the production standalone server receiving an email address, a name, a tab title, private URLs, a cursor, a bearer token, a reset token and a client IP: none of them appeared in its 8 log lines
- **Resource limits:**
  - **request bodies are read with a hard cap** that stops reading at the limit even without (or with a false) `Content-Length`: `/api/v1` 2 MB, `/api/auth` 64 KB (413 before Better Auth sees the body)
  - **database pool:** `statement_timeout` 15 s, `idle_in_transaction_session_timeout` 30 s, connection wait 10 s (mutation transactions allow 20 s)
  - **5,000 live sessions per account** (`LIMIT_REACHED`, web 422 and sync push `rejected`)
  - outbound mail calls time out after 10 s; list and pull pages are bounded (`SYNC_PROTOCOL.md` 13a and 13g)
- Dependabot/lockfile management, reproducible release build, malware/static analysis as appropriate.
- Maintain documented incident response procedure and ability to invalidate all tokens.

### Development database credentials

`infra/docker/compose.dev.yaml` uses a fixed dev-only password and binds PostgreSQL to `127.0.0.1` only. `packages/database/.env` is git-ignored; only `.env.example` is committed. Production credentials must come from the host's secret configuration (M6).

## 9. Storage and encryption disclosures

- TLS protects data in transit.
- At-rest encryption may be supplied by OS/volume/DB infrastructure; document actual deployed configuration.
- Server operators may technically access readable session metadata unless a future E2EE vault is implemented. **Never advertise zero-knowledge encryption for MVP.**
- Backups should be encrypted off-host, retention controlled, access restricted, and restore-tested.
- Local IndexedDB is not a backup if profile data is deleted/uninstalled; independent JSON exports remain important.

## 10. Release-blocking privacy checks

- [x] Cloud sync cannot start until explicit consent is recorded locally. (2026-10-16: uploads and downloads are gated on `syncState.enabledAt`, which only the Account view's opt-in (disclosure + upload preview + click) sets; unit and E2E tested)
- [x] Sync off produces zero URL/title uploads. (2026-10-16: with `enabledAt` unset or cleared the uploader and downloader return before any request; unit tested. While off, new saves stay local. 2026-10-17: also checked before every request of a run, so turning sync off or connecting another account mid-run stops it at the next round or page; one request already sent completes; unit tested)
- [ ] Per-site exclusions/query stripping (not implemented; public policy and store copy explicitly disclose whole-session, complete-URL uploads).
- [x] Another user cannot list/read/modify another user's resources (DB + HTTP tests, rerun 2026-10-17).
- [x] Revoked devices cannot push/pull; local data remains unaffected (pairing/credential DB and real-extension E2E, rerun 2026-10-17).
- [x] No external messaging bridge is shipped; own-page sender validation, Zod commands and restore preview are verified.
- [ ] No sensitive values appear in URLs, exceptions, client logs, server logs, or telemetry. (server logs verified 2026-10-17, see 8a; emailed links necessarily carry tokens in their URLs; client logs and telemetry not reviewed yet)
- [ ] Chrome Web Store permission disclosure, privacy policy and Limited Use statements are accurate.
- [ ] Vulnerability review, dependency scan, TLS verification and backup restore drill completed. (TLS: app-side requirements in 8b; verification on the deployed host per `DEPLOYMENT.md` 3 still pending)

## 11. Official documentation

- [Chrome Web Store program policies](https://developer.chrome.com/docs/webstore/program-policies)
- [Chrome permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list)
- [Chrome extension messaging security](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Better Auth extension guide](https://better-auth.com/docs/guides/browser-extension-guide)

## 12. M6 release preparation evidence (2026-10-17)

Public user-facing disclosure: `/privacy`; submission copy/categories: STORE_LISTING.md; source review/advisory triage: SECURITY_REVIEW_M6.md. Proposed URL policy in section 3 is not yet an upload filter: current payloads include all non-empty saved URLs, including internal/file/unsupported ones, when the user chooses the whole session. Do not claim exclusions or automatic token stripping. This is disclosed before public launch; configurable exclusions remain pending.

Encrypted age backups and isolated authenticated restore tests are implemented (`BACKUPS.md`). No off-host provider/schedule/retention or actual recovery drill is claimed. Release/rollback and sync-clock rollback hazards are documented in RELEASE.md. CI now requires packaged icons with correct PNG dimensions and a self-only extension CSP. Privacy publication is incomplete until operator/private contact, providers, actual retention and deployed URL are finalized.
