# syntax=docker/dockerfile:1.4
# ==============================================================================
# Workers Service Dockerfile — node:24-bookworm-slim (glibc) -> distroless
# non-root runtime. glibc base matches the distroless argon2 ABI.
#
# Build model: TRANSPILE-ONLY (ADR-0017). Every workspace package compiles to
# its own `dist/*.js` via `tsc -b` (project references), `exports` -> dist. The
# runtime resolves a bare `@core/X` import through the pnpm-ISOLATED node_modules
# symlink farm -> that package's `exports` -> its `dist`. No bundle, no hoisting,
# no esbuild. The whole built+pruned workspace tree ships from ONE stage so the
# symlink farm stays internally consistent.
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
COPY apps/workers ./apps/workers
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile && \
    pnpm install --frozen-lockfile --ignore-scripts
# `prisma generate` before the app build so @infra/prisma's tsc emit sees the
# generated client. Then `tsc -b` (driven by the workers package build, which
# references its whole workspace-dep closure) emits each package's dist + the
# app's dist/bootstrap.js (+ the standalone worker entries as separate files).
RUN pnpm --filter @infra/prisma generate && \
    pnpm --filter @apps/workers build
# Prune dev dependencies IN PLACE so the single tree we copy below carries the
# prod-only node_modules + symlink farm, consistent with the emitted dist.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ---- production: distroless, non-root ----------------------------------------
# Pinned by digest, and the pin is half of one practice: a tag can be
# republished, a digest cannot, so pinning without automation freezes whatever
# was current the day it was written. `.github/dependabot.yml` already declares
# the `docker` ecosystem for all four apps, and Dependabot updates a digest that
# is ALREADY pinned without further config — it does not add one to a bare tag.
# This FROM previously carried no tag and no digest at all, so nothing tracked
# it: every build silently took whatever `latest` pointed at that day.
#
# debian13 (trixie), not debian12 (bookworm), and the reason is measured rather
# than preferred. The bookworm image ships `libssl3 3.0.18-1~deb12u2`, which
# carries one CRITICAL and five HIGH advisories; Debian published the fix
# (openssl 3.0.20-1~deb12u2) but Google had not rebuilt the bookworm distroless
# with it. Trixie's image ships `libssl3t64 3.5.7-1~deb13u2` and `libc6
# 2.41-12+deb13u4` — past every one of them. Read out of each image's own
# `var/lib/dpkg/status.d`, not inferred from its tag.
FROM gcr.io/distroless/nodejs24-debian13@sha256:b1fc33242cc74151f50c62b4a03d48afd759dccf81279b5f8e401db4546479c1 AS production
WORKDIR /app

# Ship the whole built+pruned workspace tree from the single build stage (see
# the api Dockerfile for the isolated-layout rationale).
COPY --from=build --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /app/packages ./packages
COPY --from=build --chown=nonroot:nonroot /app/infra ./infra
COPY --from=build --chown=nonroot:nonroot /app/apps/workers/dist ./apps/workers/dist
COPY --from=build --chown=nonroot:nonroot /app/apps/workers/node_modules ./apps/workers/node_modules
COPY --from=build --chown=nonroot:nonroot /app/apps/workers/package.json ./apps/workers/package.json
COPY --from=build --chown=nonroot:nonroot /app/package.json ./package.json

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=256"

USER nonroot

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.METRICS_PORT||3300)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));"

CMD ["apps/workers/dist/bootstrap.js"]
