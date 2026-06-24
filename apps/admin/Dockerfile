# syntax=docker/dockerfile:1.4
# ==============================================================================
# Admin Service Dockerfile (Consolidated - uses shared patterns)
# ==============================================================================

# ==============================================================================
# Shared Base Stage - Node.js with pnpm
# ==============================================================================
FROM node:26-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# ==============================================================================
# Shared Dependencies Stage
# ==============================================================================
FROM base AS deps
ARG SERVICE_PATH=apps/admin
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
ARG SERVICE_PATH=apps/admin
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
# /app/packages, /app/apps/admin). The Next config defaults turbopack.root to
# os.homedir() for dev/CI, but the build runs as root (home=/root, NOT an ancestor
# of /app/apps/admin → "Invalid distDirRoot"), so pin it to /app here — the same
# value the monorepo-root default produced before. See ADR-0017 §4.
ENV NEXT_TURBOPACK_ROOT=/app

COPY apps/admin ./apps/admin

# @shared/types is consumed by the app from its prebuilt NodeNext dist (the app's
# tsconfig + the package `exports` map both resolve `@shared/types` -> dist), so
# the dist must exist before `next build` compiles the app. Build it (and its
# workspace deps via `...`) explicitly here.
RUN pnpm --filter @shared/types... build

# NEXT_BUILD_FLAGS lets CI fall back to the webpack builder (`--webpack`) if the
# Turbopack standalone build hits the open monorepo root/distDirRoot bug (#86438).
ARG NEXT_BUILD_FLAGS=""
RUN pnpm --filter @apps/admin exec next build ${NEXT_BUILD_FLAGS}

# ==============================================================================
# Production Runtime
# ==============================================================================
FROM gcr.io/distroless/nodejs24-debian12 AS production

WORKDIR /app

COPY --from=deps --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=deps --chown=nonroot:nonroot /app/packages ./packages
COPY --from=build --chown=nonroot:nonroot /app/infra ./infra
COPY --from=build --chown=nonroot:nonroot /app/apps/admin/.next/standalone ./
COPY --from=build --chown=nonroot:nonroot /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build --chown=nonroot:nonroot /app/apps/admin/public ./apps/admin/public

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3100
ENV NODE_OPTIONS="--max-old-space-size=512"

USER nonroot
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const http=require('http');const req=http.request({host:'localhost',port:3100,path:'/api/health',timeout:5000},res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.end();"

CMD ["apps/admin/server.js"]
