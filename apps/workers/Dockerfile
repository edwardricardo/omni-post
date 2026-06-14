# syntax=docker/dockerfile:1.4
# ==============================================================================
# Workers Service Dockerfile — 4-stage node:24-bookworm-slim (glibc) ->
# distroless non-root runtime. glibc base matches the distroless argon2 ABI.
# ==============================================================================

FROM node:24-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY patches/ ./patches/
COPY packages/ ./packages/
COPY infra/ ./infra/
COPY apps/workers/package.json ./apps/workers/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile && \
    pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
ENV CI=true
COPY apps/workers ./apps/workers
RUN pnpm --filter @infra/prisma exec prisma generate
RUN pnpm --filter @apps/workers build

FROM base AS prod-deps
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY patches/ ./patches/
COPY packages/ ./packages/
COPY infra/ ./infra/
COPY apps/workers/package.json ./apps/workers/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile && \
    pnpm install --frozen-lockfile --prod --ignore-scripts

FROM gcr.io/distroless/nodejs24-debian12 AS production
WORKDIR /app
COPY --from=prod-deps --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /app/apps/workers/dist ./dist
COPY --from=build --chown=nonroot:nonroot /app/infra/prisma/generated ./infra/prisma/generated
COPY --from=build --chown=nonroot:nonroot /app/package.json ./

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=256"

USER nonroot

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.METRICS_PORT||3300)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));"

CMD ["dist/bootstrap.js"]
