# syntax=docker/dockerfile:1.4
# ==============================================================================
# Admin Service Dockerfile (Consolidated - uses shared patterns)
# ==============================================================================

# ==============================================================================
# Shared Base Stage - Node.js with pnpm
# ==============================================================================
FROM node:24-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# ==============================================================================
# Build Stage
# ==============================================================================
FROM base AS build
ARG SERVICE_PATH=apps/admin
ENV CI=true

# `tsconfig.build.base.json` is NOT optional here, and its absence is what made
# this image fail to build at all: `pnpm --filter @shared/types... build` runs
# `tsc -b` against `packages/shared/tsconfig.build.json`, which extends it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json tsconfig.build.base.json ./
COPY ${SERVICE_PATH}/package.json ./${SERVICE_PATH}/
COPY patches/ ./patches/
COPY packages/ ./packages/
COPY infra/ ./infra/

# --ignore-scripts: the @infra/prisma `postinstall: prisma generate` runs during
# install before the `prisma` bin is reliably linked into the package, causing
# `prisma: not found`. We generate explicitly below via `pnpm exec` instead,
# which resolves the prisma binary from node_modules/.bin deterministically.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch && \
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

# Every workspace package this app consumes must have its dist on disk before
# `next build` runs, because that build TYPECHECKS the graph it imports — not
# only the code it bundles.
#
# It used to build `@shared/types...`, which covers ONE package, and the client
# image failed in CI for exactly that gap: six of its components import from
# `@providers/instagram/src/mediaProcessor`, that file imports
# `@adapters/external-apis` and `@adapters/storage-s3`, and neither dist
# existed — `Compiled successfully` followed by TS2307 and eight cascade errors.
# `@apps/admin^...` is the app's whole dependency closure (21 packages for the
# client, both missing adapters among them), so the selector now matches what
# the typecheck actually opens.
#
# The deeper smell is the import itself: reaching into a package's `src/` walks
# past its `exports` map, which is why a frontend build ended up typechecking a
# backend provider's adapters at all. Fixing that is app code, not image code.
RUN pnpm --filter @apps/admin^... build

# NEXT_BUILD_FLAGS lets CI fall back to the webpack builder (`--webpack`) if the
# Turbopack standalone build hits the open monorepo root/distDirRoot bug (#86438).
ARG NEXT_BUILD_FLAGS=""
RUN pnpm --filter @apps/admin exec next build ${NEXT_BUILD_FLAGS}

# ==============================================================================
# Production Runtime
# ==============================================================================
# Pinned by digest, and debian13 rather than debian12: the bookworm image ships
# an openssl carrying one CRITICAL and five HIGH advisories that Google had not
# rebuilt away, and trixie's is past them. The pin only works because
# `.github/dependabot.yml` already tracks the `docker` ecosystem — Dependabot
# updates an ALREADY-pinned digest and does not add one to a bare reference.
# The measurements, the glibc-direction reading and what the CI smoke proves:
# docs/deployment/base-images.md
FROM gcr.io/distroless/nodejs24-debian13@sha256:b1fc33242cc74151f50c62b4a03d48afd759dccf81279b5f8e401db4546479c1 AS production

WORKDIR /app

# These three lines are the WHOLE runtime. The prod node_modules, packages/ and
# infra/ that used to be copied on top of them were dead weight — measured, by
# assembling exactly this and booting it. The numbers and the method live in
# docs/deployment/image-build-model.md §"Why the portals are different".
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
