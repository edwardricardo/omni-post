# ADR-0017: Production Build Model — Bundle First-Party TS Only, Externalize node_modules

- **Status**: Accepted (revised 2026-06-14 post-CI — see §3 revision: `@infra/prisma` is externalized + tsc-compiled, not bundled)
- **Date**: 2026-06-14
- **Deciders**: Edward + Claude
- **Supersedes**: —
- **Superseded by**: —

## Context

The four production Docker images (`apps/api`, `apps/workers`, `apps/admin`,
`apps/client`) have **never built**. The repository has no JavaScript-emit
path: the backend runs under `tsx` in development, and the workspace TypeScript
packages (`@core/*`, `@ports/*`, `@adapters/*`, `@observability/*`,
`@shared/*`, `@monitoring/*`, `@infra/prisma`) are consumed directly as `.ts`
source via path aliases — never transpiled to `dist/`. There is no production
build artifact for any deployable.

A paused sibling change, `containerization-image-hardening`, already committed
the container foundation on branch `workstream/containerization-image-hardening`:

- `5024a8f5` collapsed `apps/api/Dockerfile` into a self-contained production
  layout.
- `2889986e` fixed `prisma generate` to run in a CLI-present stage and stopped
  swallowing install failures (validated on CI).
- `63982a3e` wired container-security scanning on PRs with a deterministic
  single-image Trivy ref.

Those Dockerfiles define runtime stages that expect compiled JS artifacts
(`dist/index.js`, `dist/bootstrap.js`, Next.js standalone output) that **do not
exist yet** because there is no build toolchain producing them. This ADR
establishes the canonical production build model that emits those artifacts so
the images can build, and so the paused hardening tail
(Trivy/pins/mirror/hadolint/promote) can resume on top of building images.

Two properties make a naive "just bundle everything" approach wrong here:

1. **It is a Node server, not a browser bundle.** Bundling a Node server's
   `node_modules` breaks ESM runtime semantics (`import.meta.url`, `__dirname`,
   `*.node` native addons) and is explicitly discouraged by both `tsup` and
   `esbuild` maintainers.
2. **There is exactly one native dependency (`argon2`) and Prisma v7.** Both
   are `node_modules` and must remain external; `argon2` additionally imposes a
   libc-match constraint on the build/runtime base images.

## Decision

Adopt a production build model with one principle:
**compile first-party TypeScript only; externalize 100% of `node_modules`.**

This is **not** "bundle the dependencies." The only legitimate reason to run a
bundler for a Node server in this repo is to collapse the uncompiled
first-party workspace TypeScript that lives behind path aliases into emittable
JS. Dependencies — including the native `argon2` and the Prisma client — stay
external and are resolved from `node_modules` at runtime.

### 1. Build tool and configuration (`apps/api`, `apps/workers`)

Use **tsup (primary) / raw esbuild (fallback)** with:

- `format: 'esm'`, `platform: 'node'`, `target: 'node24'`
- Multi-entry: `apps/api/src/index.ts` + `apps/workers/src/bootstrap.ts`
- Auto-externalize `dependencies` / `peerDependencies` (tsup-node behavior)
- `noExternal: [/^@core\//, /^@ports\//, /^@adapters\//, /^@observability\//, /^@shared\//, /^@monitoring\//, /^@providers\//, /^@packages\//]`
  to re-include (compile) the uncompiled workspace TS packages.
- **`@infra/prisma` is the exception — it is EXTERNAL, not bundled** (see §3
  revision). An `esbuildPlugins` `onResolve({ filter: /^@infra\// })` forces it
  external _before_ the tsconfig-paths alias can redirect `@infra/prisma` to its
  raw `src/*.ts` (a plain `external:` entry resolves too late — the alias wins).

Per-app build output: `apps/api` → `dist/index.js`; `apps/workers` →
`dist/bootstrap.js`.

### 2. libc match (blocking correctness)

`argon2` is the only native dependency and is the ABI tripwire. Building deps
on `node:24-alpine` (musl) while running on
`gcr.io/distroless/nodejs24-debian12` (glibc) is a real ABI break, and
`npm rebuild` does not bridge musl→glibc. Therefore the **deps/builder stage
MUST use a glibc base (`node:24-bookworm-slim`), never `-alpine`**, so the
`argon2` glibc prebuilt resolves without rebuild. `argon2` is externalized as a
`node_modules` dependency.

### 3. Prisma v7

Externalize `@prisma/client` + `@prisma/adapter-pg` + `pg`. Run
`prisma generate` to an **explicit output path** (`infra/prisma/generated/`) in
the build stage and `COPY` that directory into the runtime image (the generated
client is first-party generated code, and v7 no longer writes to
`node_modules/.prisma`). Prisma v7 is Rust-free, so there is **no
engine-binary copy step** — any legacy engine-copy logic must be removed.

### 3b. `@infra/prisma` — externalized + tsc-compiled (revision 2026-06-14, post-CI)

The original decision put `@infra/prisma` in `noExternal` (bundle it). The first
real CI/local build proved that wrong: the Prisma 7 generated client is raw `.ts`
with an `import * as Prisma` namespace re-exported through `export *` barrels,
which esbuild **cannot bundle** — build-time `No matching export for "Prisma"`
(its per-file transpile can't resolve a namespace re-export) plus documented
runtime crashes when bundled (`fileURLToPath(undefined)` prisma#27324, dynamic
`require("node:path")` #28126). Per the Prisma-7 canon (research, cited below) the
generated client is **tsc-compiled**, not esbuild-bundled. So `@infra/prisma` is
now: (a) **tsc-compiled separately** to ESM `.js`
(`infra/prisma/tsconfig.build.json`; `build = "prisma generate && tsc"`;
`package.json` `exports`/`main` → `./dist`), and (b) **externalized** from the
app bundle via the `onResolve` plugin (§1). `tsc` handles the `export *` namespace
re-export fine (only esbuild chokes); `Prisma.sql` (a runtime value) survives.
Dev/test still resolve `@infra/prisma` → `src/*.ts` via tsconfig paths (which
bypass `package.json`), so the `exports`→dist switch only affects the
externalized production bundle. The Dockerfiles build `@infra/prisma` (tsc)
before the app tsup build and ship `infra/prisma/dist` into the runtime.

**Hoisted production node_modules (consequence).** The app bundle inlines
workspace packages whose own transitive `node_modules` deps (e.g. `opossum` via
`@adapters/circuit-breaker`) are externalized; pnpm's default isolated layout
leaves those transitive deps unreachable from the flattened single-file bundle.
The prod-deps stage therefore uses a **hoisted** node-linker so every externalized
dep the bundle references sits at the top level.

### 4. admin / client (Next 16 standalone, separate toolchain)

Next.js is a distinct toolchain (`output: "standalone"`), not part of the
tsup build. The root cause of the `Invalid distDirRoot` failure is that
`apps/admin/next.config.mjs` (and the client equivalent) set
`turbopack: { root: os.homedir() }` — which works in CI (home is a project
ancestor) but breaks in Docker (root user; `/root` is not an ancestor of
`/app/apps/admin`). Approach: set `outputFileTracingRoot` to the workspace
root, make `turbopack.root` environment-aware, **but treat the
turbopack-root/distDirRoot interaction as known-buggy** (Next discussion #86438
OPEN, path-doubling #88579) → carry a `next build --webpack` fallback and
**pin the Next patch version**. `COPY` `public` + `.next/static` manually into
the standalone output; never `pnpm install` inside `.next/standalone`.

## Rationale

1. **The canon for a Node server is to externalize dependencies.** Both `tsup`
   and `esbuild` documentation state that bundling a Node server's deps is
   unnecessary and can break ESM. Internalizing only the uncompiled first-party
   TS is the precise, minimal use of a bundler here.
2. **`argon2` is a category, not a special case.** It is `node_modules`, so it
   is external like everything else — but its native ABI imposes the
   build-base libc match, which is a hard correctness constraint, not a
   preference.
3. **Prisma v7 generated client is first-party generated code.** Generating to
   an explicit path + `COPY` is the v7-canon deployment shape; the Rust-free
   client removes the engine-binary step entirely.
4. **Next.js standalone is a separate, officially-recipe'd path.** Following
   the official `outputFileTracingRoot` recipe + manual static copy is canon;
   the open turbopack bug forces a webpack fallback + version pin as the
   escape hatch.

## Alternatives Considered

- **Bundle `node_modules` too (single self-contained file).** ❌ Rejected.
  Breaks ESM runtime semantics (`import.meta.url`, `__dirname`, native `.node`
  addons like `argon2`). Explicitly discouraged by tsup and esbuild
  maintainers for Node servers.
- **Transpile-only with `tsc` (or `swc`), no bundler.** Considered. Would emit
  JS per file but does not resolve the path-alias workspace graph into a
  shippable tree without an additional alias-resolution + copy step across ~88
  workspace packages; tsup's `noExternal` collapses that graph in one pass.
  `tsc` also cannot externalize/internalize selectively the way the build model
  requires. Kept as a conceptual fallback only.
- **Keep running `tsx` in production.** ❌ Rejected. Ships the TypeScript
  toolchain and source into the runtime image, defeats the distroless minimal
  runtime, and pays per-request transpilation cost. The whole point of this
  change is to have a real JS-emit production path.
- **Bundle `@infra/prisma` / the Prisma 7 generated client (`noExternal`).** ❌
  Rejected (post-CI revision, §3). esbuild cannot resolve the generated client's
  `import * as Prisma` namespace re-export (build error `No matching export`) and
  mangles its runtime internals (prisma#27324 `fileURLToPath`, #28126
  `node:path`). The Prisma-7-canon path is tsc-compile + externalize.
- **tsup vs raw esbuild.** tsup chosen as primary (ergonomic multi-entry,
  `tsup-node` auto-externalize of deps, ESM defaults); raw esbuild retained as
  the fallback because tsup is a thin wrapper over esbuild and the ecosystem is
  in flux (a successor `tsdown` exists). The escape to raw esbuild is cheap.

## Consequences

**Positive**

- The four production images can build for the first time; the runtime stages
  receive the JS artifacts they already expect.
- The paused `containerization-image-hardening` tail
  (Trivy/pins/mirror/hadolint/promote) can resume on top of building images.
- The distroless runtime stays minimal: no `tsx`, no TypeScript toolchain, no
  source.

**Negative / costs**

- A new build toolchain (`tsup`/esbuild config) and per-app build wiring to
  maintain.
- The Next.js standalone path carries an open-bug workaround (webpack fallback
  - Next version pin) until upstream #86438 is fixed.
- Build correctness for tree-shaking across the codebase's dynamic-import and
  Proxy patterns is only confirmable by a real CI build + smoke boot (LXC
  cannot build).

## Revisit if

- Upstream Next.js fixes the turbopack-root/distDirRoot interaction (#86438)
  → drop the webpack fallback and re-evaluate the version pin.
- `tsup` is superseded by `tsdown` (or stalls) → the build model is unchanged;
  swap the wrapper, keep raw esbuild as the constant fallback.
- A second native dependency is added → re-confirm the libc-match constraint
  and the externalization list.

## Risks and Mitigations

| Risk                                                                                           | Mitigation                                                                                       |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Tree-shaking false negatives across ~50 static-string dynamic imports + Proxy prisma singleton | Verify with a real CI build + smoke boot of each artifact; do not trust local LXC (can't build). |
| Next.js turbopack root/distDirRoot bug (#86438 OPEN, no fix)                                   | `next build --webpack` fallback + pinned Next patch version; env-aware `turbopack.root`.         |
| musl/glibc ABI mismatch for `argon2`                                                           | Deps/builder stage on `node:24-bookworm-slim` (glibc) to match distroless-debian runtime.        |
| Prisma v7 generated client not shipped                                                         | Generate to `infra/prisma/generated/` + explicit `COPY` into runtime; no engine-binary step.     |
| `@t3-oss/env-core` fail-fast lost through bundling                                             | Smoke-boot each artifact in CI to confirm env validation still runs at module load.              |
| tsup ecosystem churn (`tsdown` successor)                                                      | Confirm tsup version behavior at adoption; raw esbuild retained as fallback.                     |

## References

- esbuild — bundling for Node (externalize node_modules):
  https://esbuild.github.io/getting-started/#bundling-for-node
- tsup — Node build tool: https://tsup.egoist.dev/
- tsup #819 — ESM externalization of Node deps:
  https://github.com/egoist/tsup/issues/819
- node-argon2 (native dep, libc constraint): https://github.com/ranisalt/node-argon2
- distroless base images: https://github.com/GoogleContainerTools/distroless
- Prisma v7 upgrade guide: https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7
- Prisma — deployment with Docker: https://www.prisma.io/docs/guides/deployment/docker
- Next.js `output: "standalone"`:
  https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- Next.js Turbopack config: https://nextjs.org/docs/app/api-reference/turbopack
- Next.js #86438 — turbopack root / `Invalid distDirRoot` (OPEN):
  https://github.com/vercel/next.js/discussions/86438
