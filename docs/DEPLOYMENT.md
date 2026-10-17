# Deployment checklist (Coolify)

> **Status (2026-10-17):** the app side of the proxy and TLS requirements is implemented and tested locally. SessionHub hasn't been deployed yet. Work through this list on the first deployment, run every **Check**, and record the results in `docs/PROGRESS.md`.
> Not covered yet: off-host backups with a restore drill and log shipping (`ROADMAP.md` M6).

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
- Any extra proxy layer adds one to the count. Too low a count trusts a client-written entry; too high a count puts many users in one bucket.

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
- [ ] Health check: `GET /api/health`. It returns 200 when the configuration is valid and 503 otherwise. It doesn't check PostgreSQL.
- [ ] After deploying, the logs show one JSON line per API request (`http_request`), without URLs, emails, tokens or client addresses (`SECURITY_PRIVACY.md` 8a).
