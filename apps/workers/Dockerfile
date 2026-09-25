# syntax=docker/dockerfile:1.4
# ==============================================================================
# Workers Service Dockerfile — node:24-bookworm-slim (glibc) -> distroless
# non-root runtime. glibc base matches the distroless argon2 ABI.
#
# Build model: TRANSPILE-ONLY (ADR-0017), shipped via `pnpm deploy`. The
# reasoning is identical for this image and the api one, so it lives in
# docs/deployment/image-build-model.md and is not restated in either.
# ==============================================================================

FROM node:24-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# ---- build: full install -> prisma generate -> tsc -b -> deploy prod tree ----
FROM base AS build
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json tsconfig.build.base.json tsconfig.build.json turbo.json ./
COPY patches/ ./patches/
COPY packages/ ./packages/
COPY infra/ ./infra/
COPY apps/workers ./apps/workers
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch && \
    pnpm install --frozen-lockfile --ignore-scripts
# `prisma generate` before the app build so @infra/prisma's tsc emit sees the
# generated client. Then `tsc -b` (driven by the workers package build, which
# references its whole workspace-dep closure) emits each package's dist + the
# app's dist/bootstrap.js (+ the standalone worker entries as separate files).
RUN pnpm --filter @infra/prisma generate && \
    pnpm --filter @apps/workers build
# `deploy` replaces the in-place `--prod` prune: ONE self-contained tree for
# this app alone, each workspace dependency materialised into the target's own
# store and packed by that package's `files` field. --ignore-scripts because
# @infra/prisma's `postinstall: prisma generate` has no CLI to run in a prod
# tree, and the emit it would produce is already in the dist this copies.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm --filter @apps/workers deploy --prod --ignore-scripts /prod/workers
# The CMD at the end of this file is a bare path into the deploy tree's root, so
# it is correct only while `deploy` puts the entry there AND everything that
# entry imports is inside the tree. Nothing downstream would catch a drift:
# distroless has no shell, and the first symptom would be a production
# crash-loop on `Cannot find module`. This asserts it where a shell still
# exists, in the same file as the CMD.
#
# IMPORTING is the point, not stat-ing. A stat proves one file exists; an import
# proves the whole module graph that entry pulls resolves from THIS tree — which
# is exactly what shrinking the closure with `pnpm deploy` puts at risk, and a
# stat would have passed straight through it. The app cannot finish booting here
# (no database, no Redis), so a RESOLUTION failure is told apart from a
# CONNECTION failure by its error code: the resolver codes fail the build, and
# anything else means the graph loaded and only infrastructure was missing.
WORKDIR /prod/workers
RUN node --input-type=module -e '\
  const unresolved = new Set(["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED", "ERR_UNSUPPORTED_DIR_IMPORT"]); \
  import("./dist/bootstrap.js").then( \
    () => console.log("dist/bootstrap.js and its whole import graph resolve"), \
    (e) => { const code = (e && e.code) || ""; \
      if (unresolved.has(code)) { console.error("deploy tree cannot resolve the CMD graph (" + code + "): " + e.message); process.exit(1); } \
      console.log("import graph resolved; boot stopped at " + (code || "a runtime error") + ", which needs services this stage has none of"); } \
  );'
WORKDIR /app

# ---- production: distroless, non-root ----------------------------------------
# Pinned by digest, and debian13 rather than debian12: the bookworm image ships
# an openssl carrying one CRITICAL and five HIGH advisories that Google had not
# rebuilt away, and trixie's is past them. The pin only works because
# `.github/dependabot.yml` already tracks the `docker` ecosystem — Dependabot
# updates an ALREADY-pinned digest and does not add one to a bare reference.
# The measurements, the glibc-direction reading and what the CI smoke proves:
# docs/deployment/base-images.md
FROM gcr.io/distroless/nodejs24-debian13@sha256:b1fc33242cc74151f50c62b4a03d48afd759dccf81279b5f8e401db4546479c1 AS production
WORKDIR /app

# ONE copy. The deploy tree's root IS the app, which is why the CMD below is
# `dist/bootstrap.js` and not `apps/workers/dist/bootstrap.js`.
COPY --from=build --chown=nonroot:nonroot /prod/workers ./

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=256"

USER nonroot

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.METRICS_PORT||3300)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));"

CMD ["dist/bootstrap.js"]
