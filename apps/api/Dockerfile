# syntax=docker/dockerfile:1.4
# ==============================================================================
# API Service Dockerfile (self-contained, production-only)
# Multi-stage: node:24-bookworm-slim (glibc) build chain -> distroless
# non-root runtime. glibc base is BLOCKING: the argon2 prebuilt must match the
# distroless/nodejs24-debian12 (glibc) runtime ABI — never -alpine (musl).
# Dev runs via local `pnpm dev` (no container). `production` is the LAST stage
# so the CI build-push-action needs no `target:` override.
#
# Build model: TRANSPILE-ONLY (ADR-0017). Every workspace package compiles to
# its own `dist/*.js` via `tsc -b` (project references), `exports` -> dist. The
# runtime resolves a bare `@core/X` import through the pnpm-ISOLATED node_modules
# symlink farm (consumer-local: apps/api/node_modules/@core/X and
# packages/<p>/node_modules/@core/X both link into the central /app/node_modules
# /.pnpm store) -> that package's `exports` -> its `dist`. No bundle, no
# hoisting, no esbuild. The whole built+pruned workspace tree ships from ONE
# stage so the symlink farm stays internally consistent.
# ==============================================================================

FROM node:24-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# ---- build: full install -> prisma generate -> tsc -b -> prune to prod -------
FROM base AS build
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.build.base.json tsconfig.build.json turbo.json ./
COPY patches/ ./patches/
COPY packages/ ./packages/
COPY infra/ ./infra/
COPY apps/api ./apps/api
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile && \
    pnpm install --frozen-lockfile --ignore-scripts
# `prisma generate` before the app build so @infra/prisma's tsc emit sees the
# generated client. Then the project-references build (`tsc -b` driven by the
# api package build, which references its whole workspace-dep closure) emits
# each package's dist + the app's dist/index.js.
RUN pnpm --filter @infra/prisma generate && \
    pnpm --filter @apps/api build
# Prune dev dependencies IN PLACE so the single tree we copy below carries the
# prod-only node_modules + symlink farm, consistent with the emitted dist.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ---- production: distroless, non-root ----------------------------------------
FROM gcr.io/distroless/nodejs24-debian12 AS production
WORKDIR /app

# Ship the whole built+pruned workspace tree from the single build stage: the
# root node_modules/.pnpm store + symlink farm, every workspace package WITH its
# emitted dist and nested node_modules symlinks, and the app's dist + nested
# node_modules. This is the minimal internally-consistent set for the isolated
# layout — a bare `@core/X` resolves via any consumer's local symlink -> the
# package exports -> dist.
COPY --from=build --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /app/packages ./packages
COPY --from=build --chown=nonroot:nonroot /app/infra ./infra
COPY --from=build --chown=nonroot:nonroot /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=nonroot:nonroot /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=nonroot:nonroot /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=nonroot:nonroot /app/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=512"

USER nonroot
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const http=require('http');const req=http.request({host:'localhost',port:3000,path:'/health',timeout:5000},res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.end();"

CMD ["apps/api/dist/index.js"]
