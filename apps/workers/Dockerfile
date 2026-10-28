# syntax=docker/dockerfile:1.4
# ==============================================================================
# Workers Service Dockerfile — node:26-bookworm-slim (glibc) -> distroless
# non-root runtime. glibc base matches the distroless argon2 ABI.
#
# Build model: TRANSPILE-ONLY (ADR-0017), shipped via `pnpm deploy`. The
# reasoning is identical for this image and the api one, so it lives in
# docs/deployment/image-build-model.md and is not restated in either.
# ==============================================================================

FROM node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe AS base
# Node 26 ships no corepack, so pnpm comes from its immutable v12.6.0 GitHub
# release, checked against the sha256 GitHub records for the asset; the slim
# image has no curl, so node's own fetch downloads it, three attempts 5 s then
# 10 s apart, each checked by sha256 before it counts. `packageManager` in
# package.json stays the version pnpm runs as. Why: docs/deployment/base-images.md
RUN set -eu; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) asset=pnpm-linux-x64.tar.gz; sum=3f4c66f668d0e84219679982d095b30da68325e1fac9284e7f5dc1584bd3d13e ;; \
      arm64) asset=pnpm-linux-arm64.tar.gz; sum=973af2b3eb9509416cf889a7336705062c936407d5fda07298814e7532f5dea1 ;; \
      *) echo "no pinned pnpm 12.6.0 build for $arch" >&2; exit 1 ;; \
    esac; \
    for attempt in 1 2 3; do \
      rm -f /tmp/pnpm.tar.gz; \
      if node -e 'fetch(process.argv[1], { signal: AbortSignal.timeout(120000) }).then(async (res) => { if (!res.ok) throw new Error(`${res.status} ${res.url}`); require("node:fs").writeFileSync("/tmp/pnpm.tar.gz", Buffer.from(await res.arrayBuffer())); })' \
           "https://github.com/pnpm/pnpm/releases/download/v12.6.0/$asset" \
         && echo "$sum  /tmp/pnpm.tar.gz" | sha256sum -c -; then break; fi; \
      [ "$attempt" -lt 3 ] || { echo "pnpm 12.6.0 asset $asset: 3 attempts failed" >&2; exit 1; }; \
      sleep $((attempt * 5)); \
    done; \
    mkdir /opt/pnpm; \
    tar -xzf /tmp/pnpm.tar.gz -C /opt/pnpm --no-same-owner; \
    rm /tmp/pnpm.tar.gz; \
    ln -s /opt/pnpm/pnpm /usr/local/bin/pnpm; \
    pnpm --version
WORKDIR /app

# ---- build: full install -> prisma generate -> tsc -b -> deploy prod tree ----
FROM base AS build
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json tsconfig.build.base.json tsconfig.build.json turbo.json ./
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
# stat would have passed straight through it.
#
# WHAT COUNTS AS A FAILURE, and the list is deliberately two-sided. The app
# cannot finish booting here (no database, no Redis), so SOME rejection is
# expected and must not fail the build. Two families do fail:
#   - the resolver codes, which mean the tree is missing something;
#   - TypeError / ReferenceError / SyntaxError, which are module-evaluation
#     DEFECTS and would otherwise have been reported as "boot stopped at a
#     runtime error" and passed. A review named that hole before this closed it.
# Anything else — a Zod env rejection, a refused connection — means the graph
# loaded and only infrastructure was missing, which is this stage's normal.
#
# The timeout and the explicit exits are the other half: an entry that opens a
# socket or registers a timer at import would otherwise leave the RUN hanging
# with no bound, and a build that hangs is worse than one that fails.
WORKDIR /prod/workers
RUN timeout 120 node --input-type=module -e '\
  const unresolved = new Set(["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED", "ERR_UNSUPPORTED_DIR_IMPORT"]); \
  const defects = new Set(["TypeError", "ReferenceError", "SyntaxError"]); \
  import("./dist/bootstrap.js").then( \
    () => { console.log("dist/bootstrap.js and its whole import graph resolve"); process.exit(0); }, \
    (e) => { const code = (e && e.code) || ""; const kind = (e && e.constructor && e.constructor.name) || ""; \
      if (unresolved.has(code)) { console.error("deploy tree cannot resolve the CMD graph (" + code + "): " + e.message); process.exit(1); } \
      if (defects.has(kind)) { console.error("the CMD graph loaded but evaluating it threw " + kind + ": " + e.message); process.exit(1); } \
      console.log("import graph resolved; boot stopped at " + (code || kind || "a runtime error") + ", which needs services this stage has none of"); \
      process.exit(0); } \
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
FROM gcr.io/distroless/nodejs26-debian13@sha256:e6ffd0e0ddbbcad0231684befb2c421591c2be46baa71da7d9065294c17efc0d AS production
WORKDIR /app

# ONE copy. The deploy tree's root IS the app, which is why the CMD below is
# `dist/bootstrap.js` and not `apps/workers/dist/bootstrap.js`.
COPY --from=build --chown=nonroot:nonroot /prod/workers ./

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=256"

USER nonroot

# EXEC FORM, and the brackets are load-bearing. Written as `CMD node -e "..."`
# Docker stores this as CMD-SHELL and runs it through `/bin/sh -c` — and this
# image is distroless, which has no shell at all (`/bin/sh`, `/bin/bash` and
# `/usr/bin/sh` are all absent, measured). The probe then cannot start: Docker
# reports the container `unhealthy` with EMPTY probe output, forever, which is
# what it did. The exec form runs the binary directly, and the path must be
# absolute for the same reason — without a shell there is no PATH lookup.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://localhost:'+(process.env.METRICS_PORT||3300)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));"]

CMD ["dist/bootstrap.js"]
