# syntax=docker/dockerfile:1.4
# ==============================================================================
# Client Service Dockerfile (Consolidated - uses shared patterns)
# ==============================================================================

# ==============================================================================
# Shared Base Stage - Node.js with pnpm
# ==============================================================================
FROM node:24-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# ==============================================================================
# Shared Dependencies Stage
# ==============================================================================
FROM base AS deps
ARG SERVICE_PATH=apps/client
ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY ${SERVICE_PATH}/package.json ./${SERVICE_PATH}/
COPY patches/ ./patches/
COPY packages/ ./packages/
COPY infra/ ./infra/

# --ignore-scripts: skip the @infra/prisma `postinstall: prisma generate` hook.
# In a --prod install the `prisma` CLI (a devDependency) is absent, so the hook
# would fail with `prisma: not found`. The runtime gets the generated client
# from the build stage, never from this prod node_modules — so skipping the
# generate hook here is correct, and the install must fail-fast (no masking).
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile && \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ==============================================================================
# Build Stage
# ==============================================================================
FROM base AS build
ARG SERVICE_PATH=apps/client
ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY ${SERVICE_PATH}/package.json ./${SERVICE_PATH}/
COPY patches/ ./patches/
COPY packages/ ./packages/
COPY infra/ ./infra/

# --ignore-scripts: the @infra/prisma `postinstall: prisma generate` runs during
# install before the `prisma` bin is reliably linked into the package, causing
# `prisma: not found`. We generate explicitly below via `pnpm exec` instead,
# which resolves the prisma binary from node_modules/.bin deterministically.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile && \
    pnpm install --frozen-lockfile --ignore-scripts

RUN pnpm --filter @infra/prisma exec prisma generate

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Container workspace root: every member lives under /app (/app/node_modules,
# /app/packages, /app/apps/client). The Next config defaults turbopack.root to
# os.homedir() for dev/CI, but the build runs as root (home=/root, NOT an ancestor
# of /app/apps/client → "Invalid distDirRoot"), so pin it to /app here — the same
# value the monorepo-root default produced before. See ADR-0017 §4.
ENV NEXT_TURBOPACK_ROOT=/app

COPY apps/client ./apps/client

# @shared/types is consumed by the app from its prebuilt NodeNext dist (the app's
# tsconfig + the package `exports` map both resolve `@shared/types` -> dist), so
# the dist must exist before `next build` compiles the app. Build it (and its
# workspace deps via `...`) explicitly here.
RUN pnpm --filter @shared/types... build

# NEXT_BUILD_FLAGS lets CI fall back to the webpack builder (`--webpack`) if the
# Turbopack standalone build hits the open monorepo root/distDirRoot bug (#86438).
ARG NEXT_BUILD_FLAGS=""
RUN pnpm --filter @apps/client exec next build ${NEXT_BUILD_FLAGS}

# ==============================================================================
# Production Runtime
# ==============================================================================
# Pinned by digest, and the pin is half of one practice: a tag can be
# republished, a digest cannot, so pinning without automation freezes whatever
# was current the day it was written. `.github/dependabot.yml` already declares
# the `docker` ecosystem for all four apps, and Dependabot updates a digest that
# is ALREADY pinned without further config — it does not add one to a bare tag.
# This FROM previously carried no tag and no digest at all, so nothing tracked
# it: every build silently took whatever `latest` pointed at that day.
#
# debian13 (trixie), not debian12 (bookworm), and the reason is measured rather
# than preferred. The bookworm image ships `libssl3 3.0.18-1~deb12u2`, which
# carries one CRITICAL and five HIGH advisories; Debian published the fix
# (openssl 3.0.20-1~deb12u2) but Google had not rebuilt the bookworm distroless
# with it. Trixie's image ships `libssl3t64 3.5.7-1~deb13u2` and `libc6
# 2.41-12+deb13u4` — past every one of them. Read out of each image's own
# `var/lib/dpkg/status.d`, not inferred from its tag.
FROM gcr.io/distroless/nodejs24-debian13@sha256:b1fc33242cc74151f50c62b4a03d48afd759dccf81279b5f8e401db4546479c1 AS production

WORKDIR /app

COPY --from=deps --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=deps --chown=nonroot:nonroot /app/packages ./packages
COPY --from=build --chown=nonroot:nonroot /app/infra ./infra
COPY --from=build --chown=nonroot:nonroot /app/apps/client/.next/standalone ./
COPY --from=build --chown=nonroot:nonroot /app/apps/client/.next/static ./apps/client/.next/static
COPY --from=build --chown=nonroot:nonroot /app/apps/client/public ./apps/client/public

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3200
ENV NODE_OPTIONS="--max-old-space-size=512"

USER nonroot
EXPOSE 3200

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const http=require('http');const req=http.request({host:'localhost',port:3200,path:'/api/health',timeout:5000},res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.end();"

CMD ["apps/client/server.js"]
