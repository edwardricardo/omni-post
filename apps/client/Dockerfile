# syntax=docker/dockerfile:1.4
# ==============================================================================
# Client Service Dockerfile (Consolidated - uses shared patterns)
# ==============================================================================

# ==============================================================================
# Shared Base Stage - Node.js with pnpm
# ==============================================================================
FROM node:26-alpine AS base
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
COPY packages/ ./packages/
COPY infra/ ./infra/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile && \
    pnpm install --frozen-lockfile --prod || echo "Some prepare scripts may have failed (expected)"

# ==============================================================================
# Build Stage
# ==============================================================================
FROM base AS build
ARG SERVICE_PATH=apps/client
ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY ${SERVICE_PATH}/package.json ./${SERVICE_PATH}/
COPY packages/ ./packages/
COPY infra/ ./infra/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile && \
    pnpm install --frozen-lockfile || echo "Some prepare scripts may have failed (expected)"

RUN pnpm --filter @infra/prisma generate

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY apps/client ./apps/client
RUN pnpm --filter @apps/client build

# ==============================================================================
# Production Runtime
# ==============================================================================
FROM gcr.io/distroless/nodejs24-debian12 AS production

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
