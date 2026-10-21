# syntax=docker/dockerfile:1.4
# ==============================================================================
# Client Service Dockerfile (Consolidated - uses shared patterns)
# ==============================================================================

# ==============================================================================
# Shared Base Stage - Node.js with pnpm
# ==============================================================================
FROM node:26.11.1-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567 AS base
# Node 26 ships no corepack, so pnpm comes from its immutable v12.6.0 GitHub
# release, checked against the sha256 GitHub records for the asset; the slim
# image has no curl, so node's own fetch downloads it, three attempts 5 s then
# 10 s apart, each checked by sha256 before it counts. `packageManager` in
# package.json stays the version pnpm runs as. Why: docs/deployment/base-images.md
RUN set -eu; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) asset=pnpm-linux-x64.tar.gz; sum=3f4c66f668d0e84219679982d095b30da68325e1fac9284e7f5dc1584bd3d13e ;; \
      arm64) asset=pnpm-linux-arm64.tar.gz; sum=973af2b3eb9509416cf889a7336705062c936407d5fda07298814e7532f5dea1 ;; \
      *) echo "no pinned pnpm 12.6.0 build for $arch" >&2; exit 1 ;; \
    esac; \
    for attempt in 1 2 3; do \
      rm -f /tmp/pnpm.tar.gz; \
      if node -e 'fetch(process.argv[1], { signal: AbortSignal.timeout(120000) }).then(async (res) => { if (!res.ok) throw new Error(`${res.status} ${res.url}`); require("node:fs").writeFileSync("/tmp/pnpm.tar.gz", Buffer.from(await res.arrayBuffer())); })' \
           "https://github.com/pnpm/pnpm/releases/download/v12.6.0/$asset" \
         && echo "$sum  /tmp/pnpm.tar.gz" | sha256sum -c -; then break; fi; \
      [ "$attempt" -lt 3 ] || { echo "pnpm 12.6.0 asset $asset: 3 attempts failed" >&2; exit 1; }; \
      sleep $((attempt * 5)); \
    done; \
    mkdir /opt/pnpm; \
    tar -xzf /tmp/pnpm.tar.gz -C /opt/pnpm --no-same-owner; \
    rm /tmp/pnpm.tar.gz; \
    ln -s /opt/pnpm/pnpm /usr/local/bin/pnpm; \
    pnpm --version
WORKDIR /app

# ==============================================================================
# Build Stage
# ==============================================================================
FROM base AS build
ARG SERVICE_PATH=apps/client
ENV CI=true

# `tsconfig.build.base.json` is NOT optional here, and its absence is what made
# this image fail to build at all: `pnpm --filter @shared/types... build` runs
# `tsc -b` against `packages/shared/tsconfig.build.json`, which extends it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json tsconfig.build.base.json ./
COPY patches/ ./patches/
COPY ${SERVICE_PATH}/package.json ./${SERVICE_PATH}/
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
# /app/packages, /app/apps/client). The Next config defaults turbopack.root to
# os.homedir() for dev/CI, but the build runs as root (home=/root, NOT an ancestor
# of /app/apps/client → "Invalid distDirRoot"), so pin it to /app here — the same
# value the monorepo-root default produced before. See ADR-0017 §4.
ENV NEXT_TURBOPACK_ROOT=/app

COPY apps/client ./apps/client

# Every workspace package this app consumes must have its dist on disk before
# `next build` runs, because that build TYPECHECKS the graph it imports — not
# only the code it bundles.
#
# It used to build `@shared/types...`, which covers ONE package, and the client
# image failed in CI for exactly that gap: six of its components import from
# `@providers/instagram/src/mediaProcessor`, that file imports
# `@adapters/external-apis` and `@adapters/storage-s3`, and neither dist
# existed — `Compiled successfully` followed by TS2307 and eight cascade errors.
# `@apps/client^...` is the app's whole dependency closure (21 packages for the
# client, both missing adapters among them), so the selector now matches what
# the typecheck actually opens.
#
# The deeper smell is the import itself: reaching into a package's `src/` walks
# past its `exports` map, which is why a frontend build ended up typechecking a
# backend provider's adapters at all. Fixing that is app code, not image code.
RUN pnpm --filter @apps/client^... build

# A browser DSN is public and the client bundle inlines it at build time; SENTRY_DSN stays runtime.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}

# NEXT_BUILD_FLAGS lets CI fall back to the webpack builder (`--webpack`) if the
# Turbopack standalone build hits the open monorepo root/distDirRoot bug (#86438).
ARG NEXT_BUILD_FLAGS=""
RUN pnpm --filter @apps/client exec next build ${NEXT_BUILD_FLAGS}

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
FROM gcr.io/distroless/nodejs26-debian13@sha256:41cdcba2d935003b9efbdaa29c7a2a1fdf79539a914ca0d5d026c03d42580d68 AS production

WORKDIR /app

# These three lines are the WHOLE runtime. The prod node_modules, packages/ and
# infra/ that used to be copied on top of them were dead weight — measured, by
# assembling exactly this and booting it. The numbers and the method live in
# docs/deployment/image-build-model.md §"Why the portals are different".
COPY --from=build --chown=nonroot:nonroot /app/apps/client/.next/standalone ./
COPY --from=build --chown=nonroot:nonroot /app/apps/client/.next/static ./apps/client/.next/static
COPY --from=build --chown=nonroot:nonroot /app/apps/client/public ./apps/client/public

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3200
ENV NODE_OPTIONS="--max-old-space-size=512"

USER nonroot
EXPOSE 3200

# EXEC FORM, and the brackets are load-bearing. Written as `CMD node -e "..."`
# Docker stores this as CMD-SHELL and runs it through `/bin/sh -c` — and this
# image is distroless, which has no shell at all (`/bin/sh`, `/bin/bash` and
# `/usr/bin/sh` are all absent, measured). The probe then cannot start: Docker
# reports the container `unhealthy` with EMPTY probe output, forever, which is
# what it did. The exec form runs the binary directly, and the path must be
# absolute for the same reason — without a shell there is no PATH lookup.
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "const http=require('http');const req=http.request({host:'localhost',port:3200,path:'/api/health',timeout:5000},res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.end();"]

CMD ["apps/client/server.js"]
