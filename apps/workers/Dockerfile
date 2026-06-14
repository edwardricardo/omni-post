# syntax=docker/dockerfile:1.4
# ==============================================================================
# Workers Service Dockerfile (Consolidated - uses shared patterns)
# ==============================================================================

# ==============================================================================
# Shared Base Stage - Node.js with pnpm
# ==============================================================================
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

# ==============================================================================
# Shared Dependencies Stage
# ==============================================================================
FROM base AS deps
ARG SERVICE_PATH=apps/workers
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
ARG SERVICE_PATH=apps/workers
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

COPY apps/workers ./apps/workers

RUN pnpm add -D -w typescript && \
    cd apps/workers && \
    pnpm exec tsc src/**/*.ts --outDir dist --skipLibCheck --module esnext --target es2022 --esModuleInterop --resolveJsonModule --moduleResolution node && \
    cd /app && \
    pnpm remove -D -w typescript

# ==============================================================================
# Production Runtime
# ==============================================================================
FROM gcr.io/distroless/nodejs24-debian12 AS production

WORKDIR /app

COPY --from=deps --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=deps --chown=nonroot:nonroot /app/packages ./packages
COPY --from=build --chown=nonroot:nonroot /app/infra ./infra
COPY --from=build --chown=nonroot:nonroot /app/apps/workers/dist ./dist
COPY --from=build --chown=nonroot:nonroot /app/package.json ./

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=256"

USER nonroot

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.METRICS_PORT||3300)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));"

CMD ["dist/bootstrap.js"]
