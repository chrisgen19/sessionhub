# Deployment checklist (Coolify)

> **Status (2026-10-17):** the app side of the proxy and TLS requirements is implemented and tested locally. The first deployment is on Coolify at `https://sessionhub.cgdev.site` (section 8). Work through this list on the first deployment, run every **Check**, and record the results in `docs/PROGRESS.md`.
> Backup policy, commands and an isolated encrypted restore drill are in `BACKUPS.md`; release/rollback in `RELEASE.md`. Actual off-host recovery and log shipping still need a deployment.

## 1. Topology

```text
browsers, extensions --HTTPS--> Coolify proxy (Traefik, TLS) --HTTP--> web :3000 --private network--> PostgreSQL
```

- Only the proxy is reachable from the internet, on ports 80 and 443.
- Never publish the `web` container's port 3000 or PostgreSQL to the internet. `infra/docker/compose.yaml` binds `web` to `127.0.0.1` only (for local runs); keep it that way or drop the mapping under Coolify.
- Images: `infra/docker/web.Dockerfile`. The `runner` target is the Next.js standalone server, non-root. The `migrate` target is a one-shot `prisma migrate deploy`.

## 2. Proxy and client IP

The app counts per-IP rate limits by client address: pairing start, device tokens, and Better Auth's sign-in, sign-up and reset limits. It never trusts the whole `X-Forwarded-For` header:

- **Every proxy appends** the address it received the request from. So only the last `TRUSTED_PROXY_COUNT` entries were written by our infrastructure.
- **The app takes the entry `TRUSTED_PROXY_COUNT` places from the right** and ignores everything to its left, which the client could have written (`apps/web/src/server/client-ip.ts`).
- **Better Auth receives only that one address.** The auth route rewrites the header before Better Auth reads it.
- **IPv6 is counted by /64 network.** A request with no usable address shares one `unknown` bucket: stricter, never a way around a limit.
- **Without a proxy, any client can choose its address.** Next.js fills in `X-Forwarded-For` from the socket only when the header is missing (`next/dist/server/base-server.js`), so a client that reaches the container directly sets its own. Never run production without the proxy in front.

### Coolify default: Traefik only

- Traefik appends the client's address to `X-Forwarded-For` by default: its `forwardedHeaders.notAppendXForwardedFor` setting defaults to `false` ([Traefik entrypoints reference](https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/)).
- Coolify's generated Traefik configuration sets no `forwardedHeaders` options (`bootstrap/helpers/proxy.php` in coollabsio/coolify, checked 2026-10-17).
- [ ] `TRUSTED_PROXY_COUNT=1`. This is the default when unset.
- [ ] Never set `notAppendXForwardedFor` on the proxy. The app would then see only what clients send, or the proxy's own address for everyone.

### With a CDN in front (for example Cloudflare's proxied DNS)

- [ ] `TRUSTED_PROXY_COUNT=2`: the CDN records the client, then Traefik records the CDN edge.
- [ ] Add the CDN's published address ranges as `forwardedHeaders.trustedIPs` in the server's Traefik configuration in Coolify. Coolify appends custom proxy flags after its defaults.
- [ ] Firewall ports 80 and 443 so only the CDN's ranges can connect. Otherwise a client that connects to the server directly can write its own address into the counted position.
- Any extra proxy layer adds one to the count. Too high a count can trust a client-written entry; too low a count puts many users in one bucket.

**Check** (from a machine outside the server, against the deployed origin). Six pairing starts with a different fake `X-Forwarded-For` each: the first five get `201`, the sixth gets `429`. That means the fake values were ignored. This uses up your own pairing budget for a minute.

```sh
APP=https://sessionhub.example.com
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "$APP/api/v1/pairing" \
    -H 'content-type: application/json' -H "x-forwarded-for: 10.0.0.$i" \
    -d "{\"installationId\":\"$(uuidgen | tr 'A-Z' 'a-z')\",\"deviceName\":\"Checklist\",\"browser\":null}"
done
```

## 3. TLS

- [ ] Give the application its domain with `https://` in Coolify. Traefik then gets a Let's Encrypt certificate through Coolify's `letsencrypt` resolver, using the HTTP-01 challenge on port 80.
- [ ] Keep port 80 open: certificate renewals need it.
- [ ] `BETTER_AUTH_URL` is exactly the public origin, e.g. `https://sessionhub.example.com` (no path, no trailing slash).
  - In production the app refuses plain `http://` for anything but `localhost`, `127.0.0.1` and `[::1]`.
  - With a wrong value, `/api/health` answers `503 {"status":"misconfigured"}`, so the deployment never turns healthy, and the log gets one `config_invalid` line naming the variable (never its value).
  - Other configuration errors (a short `BETTER_AUTH_SECRET`, missing mail settings) are reported the same way.
- [ ] Build the extension with `WXT_API_BASE_URL=https://<domain>`. The build refuses `http://` except for localhost (`apps/extension/wxt.config.ts`).
- What the app does once the URL is `https://`:
  - **Session cookie:** named `__Secure-better-auth.session_token`, with `HttpOnly; Secure; SameSite=Lax`.
  - **HSTS:** every response of the production build carries `Strict-Transport-Security: max-age=31536000`. Browsers ignore it over plain http. Once a browser has seen it over https, it refuses http for that host for a year. It covers this host only (no `includeSubDomains`, no preload).

**Checks:**

```sh
APP=sessionhub.example.com
curl -sI "http://$APP/" | head -3                       # expect a redirect (301/308) to https://
curl -s -D - -o /dev/null "https://$APP/api/health" | grep -i strict   # expect strict-transport-security: max-age=31536000
curl -s -D - -o /dev/null "https://$APP/login" | grep -i -E "frame-ancestors|x-frame-options"   # expect frame-ancestors 'none' and DENY (SECURITY_PRIVACY.md 8b)
curl -s "https://$APP/api/health"                                       # expect {"status":"ok"}
curl -s -D - -o /dev/null "https://$APP/api/v1/sessions" | grep -i -E "^HTTP|x-request-id"   # 401, with a request id
openssl s_client -connect "$APP:443" -servername "$APP" </dev/null | openssl x509 -noout -issuer -enddate
```

- [ ] Sign in, then check the cookie in the browser's developer tools: `__Secure-` prefix, `Secure`, `HttpOnly`.

## 4. Environment (web)

| Variable | Production value |
|---|---|
| `DATABASE_URL` | Server-only PostgreSQL URL on the private network |
| `BETTER_AUTH_SECRET` | At least 32 random characters (`openssl rand -hex 32`) |
| `BETTER_AUTH_URL` | `https://<domain>` (section 3) |
| `TRUSTED_PROXY_COUNT` | `1` behind Coolify's Traefik; `2` with a CDN in front (section 2) |
| `MAIL_TRANSPORT` | `resend` for password reset and email confirmation (`disabled` turns both off) |
| `MAIL_FROM` | Sender on a domain verified in Resend |
| `RESEND_API_KEY` | Server-only |

No secrets in `NEXT_PUBLIC_*` or `WXT_*` variables.

## 5. Deploy order and health

- [ ] Run the `migrate` image before `web`. The compose stack does this: `web` waits for `migrate` to finish successfully.
- [ ] Health check: `GET /api/health`. It returns uncached 200 when configuration is valid and a PostgreSQL probe succeeds; 503 `misconfigured` for configuration errors or `unavailable` for a failed database probe. No database details are returned.
- [ ] After deploying, the logs show one JSON line per API request (`http_request`), without URLs, emails, tokens or client addresses (`SECURITY_PRIVACY.md` 8a).

## 6. Extension release ZIP

The `extension-zip` CI job builds the Chrome Web Store ZIP on every PR and every push to `main`. It builds it twice and checks it with `apps/extension/scripts/check-release-zip.ts`.

**What fails the job:**
- The two builds of the same commit differ: the ZIP must be reproducible. (It also doesn't depend on the build directory, and its file timestamps are normalised.)
- The manifest isn't MV3, or its version doesn't match `apps/extension/package.json`.
- The permissions aren't exactly the documented set (`SECURITY_PRIVACY.md` section 6).
- `host_permissions` is anything other than the configured https origin.
- The manifest has content scripts, `externally_connectable`, `web_accessible_resources` or optional permissions.
- The ZIP contains source maps, or the HTML loads remote scripts.
- The service worker doesn't contain the configured origin, or the bundle still contains the development server `localhost:3000`.

**What also fails:** missing or incorrectly sized 16/32/48/128 PNG icons, or an extension CSP other than `script-src 'self'; object-src 'self'`.

**What only warns:** a build for the placeholder origin.

- [ ] Set the repository variable `EXTENSION_API_BASE_URL` (GitHub: Settings, Secrets and variables, Actions, Variables) to the production origin, the same value as `BETTER_AUTH_URL`.
  - Without it, CI builds for `https://sessionhub.invalid` (a reserved name that never resolves) and uploads nothing.
  - With it, every run uploads `sessionhub-extension-<commit>` (`sessionhub-<version>-chrome.zip`, kept 30 days).
- [ ] Before store submission, finalize `STORE_LISTING.md`, the public `/privacy` operator/contact/provider/retention details and reviewer access. Icons and synthetic local-flow screenshots are included; account-flow screenshots need the actual service.
- [ ] Raise `version` in `apps/extension/package.json` for every store upload: the store refuses a version it already has.
- Local equivalent: `WXT_API_BASE_URL=https://<domain> pnpm --filter @sessionhub/extension zip:release`. It writes to `apps/extension/.output`; delete older ZIPs there first, because the check expects exactly one.


## 7. Backups, rollback and final gates

- [ ] Configure the encrypted off-host backup schedule, retention, restricted credentials, failure alerts and offline age key recovery (`BACKUPS.md`).
- [ ] Download an off-host object on an independent machine, verify its checksum, run the disposable drill and a full isolated staging app restore. Record measured RPO/RTO, migration status and app checks in PROGRESS.
- [ ] Record immutable images, app commit, extension version/hash and migration compatibility before promotion (`RELEASE.md`). Never restore a database over the live volume or resume sync after a database rollback without reconciling client cursors/outboxes.
- [ ] Finalize private privacy/deletion contact, hosting providers, actual retention, public privacy URL and real Resend delivery before opening registration. Review dependency exceptions in `SECURITY_REVIEW_M6.md` against a fresh scan.

## 8. This deployment: Coolify at sessionhub.cgdev.site (2026-10-17)

Set up with the `coolify` CLI (and the Coolify API for the three settings CLI 1.8.0 can't set), following the JobTrack procedure (`chrisgen19/jobtrack` `docs/DEPLOYMENT_COOLIFY.md`) and Debt Tracker's deploy trigger. User's choices: this domain, the shared PostgreSQL, Resend on JobTrack's verified domain, CI-triggered deploys.

| Item | Value |
|---|---|
| Coolify instance | `https://coolify.cgdiomampo.dev` (CLI context `prod`), server `localhost` (`hsskococ4osg0oskw0kkkc8s`) |
| Project / environment | `SessionHub` (`toqk7ximnojdgenpv7zcqu0u`) / `production` |
| Application | `sessionhub` (`v5tdb1gh3vky09itrppd4t33`): GitHub App `vast-vicuna-sso40848s4wcgokgg` (the one JobTrack uses), `chrisgen19/sessionhub` `main`, Docker Compose build pack, `/compose.coolify.yaml` |
| Domain | `https://sessionhub.cgdev.site` on the `web` service (`*.cgdev.site` already points at the server); force HTTPS on |
| Network | **Connect to Predefined Network** on, so `web` and `migrate` reach the database's internal hostname |
| Auto-deploy | **Off.** The CI `deploy` job deploys `main` after `check`, `e2e-extension`, `e2e-web`, `extension-zip` and `docker` pass |
| Database | Shared PostgreSQL 17 (`o0cc0cgwcc0wccc04k880gg4`, project "Postgres Database"): role `sessionhub` (login, not superuser, no CREATEDB) owning database `sessionhub`; `CONNECT` revoked from `PUBLIC`. The app connects over the private network: `postgresql://sessionhub:<password>@o0cc0cgwcc0wccc04k880gg4:5432/sessionhub` |
| Backups | `sessionhub` added to that instance's daily schedule (`z4fynbkees3nazddvjvacbv0`: 18:00 UTC, S3 on, 7 local / 30 days on S3). The encrypted off-host procedure in `BACKUPS.md` is still to do |
| Environment | Runtime only, literal: `DATABASE_URL`, `BETTER_AUTH_SECRET` (random, 64 hex), `BETTER_AUTH_URL=https://sessionhub.cgdev.site`, `TRUSTED_PROXY_COUNT=1`, `MAIL_TRANSPORT=resend`, `MAIL_FROM=SessionHub <noreply@support.cgdiomampo.dev>`, `RESEND_API_KEY` (JobTrack's key) |

**Deploys.** Merging to `main` deploys: the `deploy` job POSTs to the repository secret `COOLIFY_DEPLOY_WEBHOOK` (`https://coolify.cgdiomampo.dev/api/v1/deploy?uuid=v5tdb1gh3vky09itrppd4t33&force=false`) with `COOLIFY_TOKEN` (a Coolify API token with deploy permission). Without them the job skips with a notice. A manual deploy: `coolify deploy uuid v5tdb1gh3vky09itrppd4t33` (CLI context `prod`).

**The deploy token: check it before saving it.** `COOLIFY_TOKEN` must be an API token of *this* Coolify (`coolify.cgdiomampo.dev`, Root Team) with the `deploy` permission. A token from another instance (the CLI also has `localhost:8000` and `app.coolify.io` contexts), a deleted token, or the wrong text makes every deploy fail with `401 Unauthenticated.`, which is what happened all morning on 2026-10-17.

1. With the token in the clipboard, ask this Coolify whether it knows it:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $(pbpaste | tr -d '[:space:]')" https://coolify.cgdiomampo.dev/api/v1/teams/current
   ```

   - `403`: recognised, deploy-only (what CI should have).
   - `200`: recognised, with read access too (works, but more than CI needs).
   - `401`: not a token of this Coolify. Don't save it.
2. Save it without whitespace: `pbpaste | tr -d '[:space:]' | gh secret set COOLIFY_TOKEN -R chrisgen19/sessionhub`.
3. Re-run the `deploy` job of the latest `main` run (a re-run reads the secrets as they are now). Check that Coolify lists a finished deployment and that `/api/health` is ok.

Without the clipboard, a deploy-only token can be created on the server itself and piped straight into the secret, never printed. This is how the current token, `github-actions sessionhub deploy`, was made on 2026-10-17. This Coolify version takes the token's team from the web session, so the script sets it:

```sh
TOKEN=$(ssh vps 'docker exec -i coolify php artisan tinker --no-interaction' <<'PHP' | grep -oE '[0-9]+\|[A-Za-z0-9]{40,}' | tail -1
session(["currentTeam" => App\Models\Team::find(0)]);
echo App\Models\User::find(0)->createToken("github-actions sessionhub deploy", ["deploy"])->plainTextToken, PHP_EOL;
PHP
)
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" https://coolify.cgdiomampo.dev/api/v1/teams/current   # expect 403
printf '%s' "$TOKEN" | gh secret set COOLIFY_TOKEN -R chrisgen19/sessionhub; unset TOKEN
```

Revoke a replaced token in Coolify (Keys & Tokens). The older `github-actions-deploy` token (created 2026-09-02, last used 2026-09-29) predates this app (created in Coolify on 2026-10-17), so it serves another project, if any; revoke it only once no repository uses it.

**Notes for this host:**
- The PostgreSQL 17 instance is shared with other apps; SessionHub's migrations use nothing newer than 17 (CI tests on 18).
- The shared instance also has a public port (used by Debt Tracker). SessionHub never uses it; the role and database were created through it once, as the superuser, from the operator's machine.
- Point the extension at this server: `WXT_API_BASE_URL=https://sessionhub.cgdev.site` (repository variable `EXTENSION_API_BASE_URL`, section 6).
- Sections 2 and 3 checked on 2026-10-17 against `83cdd15` (results in `PROGRESS.md`): all pass except that plain http answers **307** (Coolify's non-permanent redirect) instead of 301/308. HSTS makes browsers use https after the first visit. Still to check by hand: the `__Secure-` session cookie after signing in.
