# syntax=docker/dockerfile:1.4
# ==============================================================================
# API Service Dockerfile (self-contained, production-only)
# Multi-stage: node:24-bookworm-slim (glibc) build chain -> distroless
# non-root runtime. glibc base is BLOCKING: the argon2 prebuilt must match the
# distroless/nodejs24-debian13 (glibc) runtime ABI — never -alpine (musl).
# Dev runs via local `pnpm dev` (no container). `production` is the LAST stage
# so the CI build-push-action needs no `target:` override.
#
# Build model: TRANSPILE-ONLY (ADR-0017), shipped via `pnpm deploy`. The
# reasoning is identical for this image and the workers one, so it lives in
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
COPY apps/api ./apps/api
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch && \
    pnpm install --frozen-lockfile --ignore-scripts
# `prisma generate` before the app build so @infra/prisma's tsc emit sees the
# generated client. Then the project-references build (`tsc -b` driven by the
# api package build, which references its whole workspace-dep closure) emits
# each package's dist + the app's dist/index.js.
RUN pnpm --filter @infra/prisma generate && \
    pnpm --filter @apps/api build
# `deploy` replaces the in-place `--prod` prune. It writes ONE self-contained
# tree for this app alone: its prod closure, with every workspace dependency
# materialised into the target's own store and packed by that package's `files`
# field. --ignore-scripts because @infra/prisma's `postinstall: prisma generate`
# has no CLI to run in a prod tree, and the emit it would produce is already in
# the dist this copies.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm --filter @apps/api deploy --prod --ignore-scripts /prod/api
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
WORKDIR /prod/api
RUN node --input-type=module -e '\
  const unresolved = new Set(["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED", "ERR_UNSUPPORTED_DIR_IMPORT"]); \
  import("./dist/index.js").then( \
    () => console.log("dist/index.js and its whole import graph resolve"), \
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

# ONE copy. The deploy tree is already the whole runtime: `dist`, its own
# node_modules store, and the manifest. Its root IS the app, which is why the
# CMD below is `dist/index.js` and not `apps/api/dist/index.js`.
COPY --from=build --chown=nonroot:nonroot /prod/api ./

ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=512"

USER nonroot
EXPOSE 3000

# EXEC FORM, and the brackets are load-bearing. Written as `CMD node -e "..."`
# Docker stores this as CMD-SHELL and runs it through `/bin/sh -c` — and this
# image is distroless, which has no shell at all (`/bin/sh`, `/bin/bash` and
# `/usr/bin/sh` are all absent, measured). The probe then cannot start: Docker
# reports the container `unhealthy` with EMPTY probe output, forever, which is
# what it did. The exec form runs the binary directly, and the path must be
# absolute for the same reason — without a shell there is no PATH lookup.
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "const http=require('http');const req=http.request({host:'localhost',port:3000,path:'/health',timeout:5000},res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.end();"]

CMD ["dist/index.js"]
