# syntax=docker/dockerfile:1.4
# ==============================================================================
# API Service Dockerfile (self-contained, production-only)
# Multi-stage: node:24-alpine build chain -> distroless non-root runtime.
# Dev runs via local `pnpm dev` (no container). `production` is the LAST stage
# so the CI build-push-action needs no `target:` override.
# ==============================================================================

# ==============================================================================
# Base Stage - Node.js with pnpm
# ==============================================================================
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

# ==============================================================================
# Dependencies Stage - production-only install for the runtime node_modules
# ==============================================================================
FROM base AS deps
ARG SERVICE_PATH=apps/api
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
# Build Stage - full install, prisma client generate, TypeScript compile
# ==============================================================================
FROM base AS build
ARG SERVICE_PATH=apps/api
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

COPY apps/api ./apps/api

RUN pnpm add -D -w typescript && \
    cd apps/api && \
    pnpm exec tsc --outDir dist --skipLibCheck && \
    cd /app && \
    pnpm remove -D -w typescript

# ==============================================================================
# Production Runtime - distroless, non-root
# ==============================================================================
FROM gcr.io/distroless/nodejs24-debian12 AS production

WORKDIR /app

COPY --from=deps --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=deps --chown=nonroot:nonroot /app/packages ./packages
COPY --from=build --chown=nonroot:nonroot /app/infra ./infra
COPY --from=build --chown=nonroot:nonroot /app/apps/api/dist ./dist
COPY --from=build --chown=nonroot:nonroot /app/package.json ./

ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=512"

USER nonroot
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const http=require('http');const req=http.request({host:'localhost',port:3000,path:'/health',timeout:5000},res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.end();"

CMD ["dist/index.js"]
