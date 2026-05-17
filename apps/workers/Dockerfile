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
COPY packages/ ./packages/
COPY infra/ ./infra/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile && \
    pnpm install --frozen-lockfile --prod || echo "Some prepare scripts may have failed (expected)"

# ==============================================================================
# Build Stage
# ==============================================================================
FROM base AS build
ARG SERVICE_PATH=apps/workers
ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY ${SERVICE_PATH}/package.json ./${SERVICE_PATH}/
COPY packages/ ./packages/
COPY infra/ ./infra/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile && \
    pnpm install --frozen-lockfile || echo "Some prepare scripts may have failed (expected)"

RUN pnpm --filter @infra/prisma generate

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

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "const Redis=require('ioredis');const redis=new Redis(process.env.REDIS_URL||'redis://localhost:6379');redis.ping().then(()=>{redis.disconnect();process.exit(0)}).catch(()=>process.exit(1));"

CMD ["dist/bootstrap.js"]
