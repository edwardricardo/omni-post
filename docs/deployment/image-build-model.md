# Image build model — how `api` and `workers` reach a production tree

> The single source for HOW the two node runtimes are assembled, and WHY each
> step is the step it is. `apps/api/Dockerfile` and `apps/workers/Dockerfile`
> point here instead of restating it, for the same reason
> `docs/deployment/base-images.md` exists: a fact written in four places is a
> fact that will be corrected in one of them.
>
> The Next portals (`apps/admin`, `apps/client`) do NOT use this model — see
> §"Why the portals are different" at the end.

**Owner:** Platform engineering

---

## The model in one line

Compile every workspace package to its own `dist` with `tsc -b`, then hand
`pnpm deploy` one app and let it write a self-contained production tree.

---

## Step 1 — transpile-only (ADR-0017)

Every workspace package compiles to its own `dist/*.js` via `tsc -b` (project
references), and its `exports` map points at that `dist`. No bundle, no
hoisting, no esbuild. A bare `@core/X` import resolves through pnpm's isolated
node_modules layout to that package's `exports`, and from there to its `dist`.

`prisma generate` runs BEFORE the app build, because `@infra/prisma`'s own `tsc`
emit compiles the generated client into `dist/generated`.

## Step 2 — `pnpm deploy`, not an in-place `--prod` prune

The earlier shape installed the whole workspace, built it, then re-installed
with `--prod` IN PLACE and copied the entire tree — root `node_modules/.pnpm`
store, every `packages/*` directory, `infra/`, and the app. That ships one
app's runtime plus every other app's dependencies, plus every package's source.

`pnpm deploy --prod --filter <app> <target>` writes ONE tree for ONE app: its
production closure only, with each workspace dependency **materialised into the
target's own store** rather than symlinked back at the monorepo. The result is
self-contained, so the production stage is a single `COPY`, and the target's
root IS the app — which is why the `CMD` is `dist/index.js` and not
`apps/<name>/dist/index.js`.

`--ignore-scripts` is required: `@infra/prisma` declares
`postinstall: prisma generate`, and a `--prod` tree has no `prisma` CLI to run
it. The emit that hook would produce is already inside the `dist` being copied.

## Step 3 — `files` is what decides the image contents

**This is the part that is easy to get wrong, because nothing fails when it is
wrong.** `pnpm deploy` packs each workspace package the way `npm pack` would, so
a manifest with **no `files` field ships the entire package directory**. Before
these fields existed, measured on the `api` deploy tree:

| What shipped                                                                | Size           |
| --------------------------------------------------------------------------- | -------------- |
| `apps/api` root, of which `dist` was 9.7M                                   | **96M**        |
| ... its knowledge graph (`graphify-out`)                                    | 20M            |
| ... mutation/coverage reports (`reports`)                                   | 21M            |
| ... `.vitest-reports`                                                       | 23M            |
| ... the test suite                                                          | 9.1M           |
| ... the TypeScript source                                                   | 5.8M           |
| `@core/engine`, whose `dist` is 28K                                         | **21M**        |
| 190 materialised packages each carrying `src`, `tests`, `.turbo`, tsconfigs | 7.4M src+tests |
| 99 of those also carrying a `.claude` directory                             | —              |

The size is the lesser half. A production image carrying the test suite, the
TypeScript source and agent configuration is a supply-chain surface, not a
rounding error.

`@core/engine` is the sharpest case and explains the 21M: its package root is
`packages/core`, the PARENT of every other `@core/*` package, so packing it
without `files` copies the whole core tree for a 28K emit.

Two rules follow:

1. **Every workspace manifest declares `files`.** For almost all of them that is
   `["dist"]`.
2. **`@infra/prisma` is the one exception, and its list is reasoned, not
   generous:** `["dist", "migrations", "schema.prisma", "prisma.config.ts"]`.
   `generated` is deliberately ABSENT — Prisma 7's generator emits TypeScript
   into `generated/prisma/client`, `tsc -b` compiles it into `dist/generated`,
   and the runtime entry `dist/src/client.js` imports
   `../generated/prisma/client/client.js`, which resolves INSIDE `dist`. The
   top-level tree is a build input (14M of `.ts` and source maps) that no
   shipped code path opens.

## Measured result

Each step measured on the `api` production closure, same method throughout:

| After                                        | Deploy tree |
| -------------------------------------------- | ----------- |
| in-place `--prod` prune (the CI image)       | 2.0G        |
| `pnpm deploy`                                | 1.5G        |
| `next-intl` extracted out of `@shared/types` | 1.1G        |
| `googleapis` monolith → per-API packages     | 892M        |
| `files` on every workspace manifest          | 783M        |
| `generated` dropped from `@infra/prisma`     | 770M        |

The `workers` closure measures 567M by the same method.

Against a CI limit of 1.0 GiB (`LIMIT_BYTES` in the production CI workflow).

**Measure one tree per `du` invocation.** pnpm hardlinks package files from a
shared store, and `du` counts each inode once per run, so `du -sh treeA treeB`
attributes everything the two share to whichever it walks first. Measured that
way the `workers` tree reported **30M** against its real 567M — a 95% "saving"
that was an artefact of the command, not of anything in the image.

## What is still in there, named rather than absorbed

`@prisma/client` declares `prisma` and `typescript` as **optional peer
dependencies**, and pnpm resolves them, so a `--prod` deploy tree carries the
Prisma CLI (42M), `@prisma/studio-core` (43M), `@electric-sql/pglite` (24M) and
`typescript` (24M) — **133M of build-time tooling in a production closure**. No
manifest in this repository asks for it; the peer edge does. Unfixed, measured,
and not disguised as anything else.

## Why the portals are different

`apps/admin` and `apps/client` build with Next's `standalone` output, which
traces its own dependency closure and emits a `server.js` plus a pruned
`node_modules`. That is the same job `pnpm deploy` does, done by a tool that
also knows about the App Router's runtime shape. Running both would mean two
tools disagreeing about one tree, so the portals keep Next's tracer.

**Both portal images used to copy the full production `node_modules`, the whole
`packages/` tree and `infra/` ON TOP of that standalone output.** The trace looks
alarmingly small — 16 entries, of which `next`, `react`, `react-dom` and `sharp`
are the recognisable ones, and NOT ONE workspace package — which reads like a
tracing failure and is not: the App Router bundles everything it imports into
`.next/server`, so only Next's server-external packages survive as real
node_modules. `@tanstack/react-query` is absent for exactly the same reason it is
absent from a browser bundle's node_modules.

That was settled by running it rather than by reading it. Each standalone tree
was assembled exactly as its three `COPY` lines assemble it — `standalone/`,
plus `.next/static`, plus `public`, and nothing else — and booted on this
machine:

| Portal   | Assembled tree | `/api/health` | `/` followed                | Module errors |
| -------- | -------------- | ------------- | --------------------------- | ------------- |
| `admin`  | 50M            | 200           | 200, 72,928 B, `/en/login`  | none          |
| `client` | 84M            | 200           | 200, 112,285 B, `/en/login` | none          |

The i18n middleware runs (both `/` responses are 307s followed to a locale
route) and the pages render server-side, so this is the real server code path,
not a static file being served.

**A defect this proof surfaced, which no test had:** neither portal HAD an
`/api/health` route. Both Dockerfiles' `HEALTHCHECK` has always requested it and
exits non-zero on anything but a 200, so **every admin and client container has
reported `unhealthy` for its entire life** — a signal an orchestrator acts on by
restarting a process that was serving correctly. The route exists now in both
(`app/api/health/route.ts`), returns 200, and is deliberately dependency-free:
a liveness probe that calls the backend turns an API outage into a restart loop
of portals that are fine.

---

## How to extend

1. **New workspace package** → give it `"files": ["dist"]` in the same commit
   that creates it. A package without one ships its whole directory, silently.
2. **A package that needs a non-emit runtime asset** → widen ITS `files` and say
   here why the asset is a runtime input rather than a build input, the way the
   `@infra/prisma` entry does.
3. **New deployable on the node runtime** → point its Dockerfile at this file
   rather than copying the reasoning into it.
4. **Changing the base image** → different question, different file:
   `docs/deployment/base-images.md`.
