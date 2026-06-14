# syntax=docker/dockerfile:1.4
# ==============================================================================
# API Service Dockerfile (self-contained, production-only)
# Multi-stage: node:24-bookworm-slim (glibc) build chain -> distroless
# non-root runtime. glibc base is BLOCKING: the argon2 prebuilt must match the
# distroless/nodejs24-debian12 (glibc) runtime ABI — never -alpine (musl).
# Dev runs via local `pnpm dev` (no container). `production` is the LAST stage
# so the CI build-push-action needs no `target:` override.
# ==============================================================================

FROM node:24-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# ---- deps: FULL install (build needs tsup + prisma CLI) ----------------------
FROM base AS deps
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY patches/ ./patches/
COPY packages/ ./packages/
COPY infra/ ./infra/
COPY apps/api/package.json ./apps/api/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile && \
    pnpm install --frozen-lockfile --ignore-scripts

# ---- build: prisma generate + tsc-compile @infra/prisma + tsup ESM bundle ----
FROM deps AS build
ENV CI=true
COPY apps/api ./apps/api
# @infra/prisma is tsc-compiled to ESM JS (dist/) and EXTERNALIZED from the app
# bundle (the Prisma 7 generated client cannot be esbuild-bundled). The app's
# tsup build emits a bare `import "@infra/prisma"`; at runtime node resolves it
# via node_modules → infra/prisma/package.json `exports` → dist/. So the client
# MUST be compiled here, BEFORE the app build, and shipped into the runtime.
RUN pnpm --filter @infra/prisma build
RUN pnpm --filter @apps/api build

# ---- prod-deps: runtime node_modules only ------------------------------------
FROM base AS prod-deps
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY patches/ ./patches/
COPY packages/ ./packages/
COPY infra/ ./infra/
COPY apps/api/package.json ./apps/api/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile && \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ---- production: distroless, non-root ----------------------------------------
FROM gcr.io/distroless/nodejs24-debian12 AS production
WORKDIR /app
COPY --from=prod-deps --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /app/apps/api/dist ./dist
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
ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=512"

USER nonroot
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const http=require('http');const req=http.request({host:'localhost',port:3000,path:'/health',timeout:5000},res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.end();"

CMD ["dist/index.js"]
