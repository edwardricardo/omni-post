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
# @infra/prisma is tsc-compiled to ESM JS (dist/) and EXTERNALIZED from the app
# bundle (the Prisma 7 generated client cannot be esbuild-bundled). The app's
# tsup build emits a bare `import "@infra/prisma"`; at runtime node resolves it
# via node_modules → infra/prisma/package.json `exports` → dist/. So the client
# MUST be compiled here, BEFORE the app build, and shipped into the runtime.
RUN pnpm --filter @infra/prisma build
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
# The externalized @infra/prisma resolves at runtime via the pnpm workspace
# symlink (node_modules/.pnpm/node_modules/@infra/prisma -> ../../../../infra/prisma)
# to /app/infra/prisma, whose package.json `exports` map points at ./dist (the
# tsc-compiled client) and re-exports the generated client under ./generated.
# Ship all three so the bare `import "@infra/prisma"` in the bundle resolves.
COPY --from=build --chown=nonroot:nonroot /app/infra/prisma/dist ./infra/prisma/dist
COPY --from=build --chown=nonroot:nonroot /app/infra/prisma/generated ./infra/prisma/generated
COPY --from=build --chown=nonroot:nonroot /app/infra/prisma/package.json ./infra/prisma/package.json
COPY --from=build --chown=nonroot:nonroot /app/package.json ./

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=256"

USER nonroot

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.METRICS_PORT||3300)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));"

CMD ["dist/bootstrap.js"]
