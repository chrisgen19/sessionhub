# syntax=docker/dockerfile:1
# SessionHub web app (Next.js standalone) and its migration job.
# Build from the repo root:
#   docker build -f infra/docker/web.Dockerfile --target runner  -t sessionhub-web .
#   docker build -f infra/docker/web.Dockerfile --target migrate -t sessionhub-migrate .
# No secrets are needed at build time; they are read at runtime (see infra/docker/compose.yaml).

ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
# openssl: Prisma's schema engine (migrate job). libc6-compat: glibc shims some Node tooling expects.
RUN apk add --no-cache openssl libc6-compat
RUN npm install --global pnpm@11.17.0
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo

FROM base AS build
COPY . .
# Only the web app and its workspace dependencies (the extension isn't built here).
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@sessionhub/web..."
RUN pnpm --filter @sessionhub/web build

# One-shot migration job: `prisma migrate deploy` applies pending migrations and never
# resets data. Run it explicitly before starting (or updating) the web service.
FROM base AS migrate
COPY . .
# Only the database package (Prisma CLI, schema, migrations): no Next.js or extension tooling.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @sessionhub/database
WORKDIR /repo/packages/database
USER node
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# Root-owned, read-only for the app user; only Next's cache directory is writable.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
