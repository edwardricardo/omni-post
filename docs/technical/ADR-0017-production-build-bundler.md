# ADR-0017: Production Build Model — Transpile-Only (Per-Package `tsc` Emit + Project References)

- **Status**: Accepted (revised 2026-06-16 — the dev/test/CI resolution model is now codified as a TWO-MECHANISM contract, see §1c; supersedes the binary "prod=dist / dev=paths" framing of §1/§3b. Prior revision 2026-06-15: production build is TRANSPILE-ONLY per-package `tsc` emit; the tsup bundle is rejected, see §1 + Alternatives)
- **Date**: 2026-06-14 (transpile-only revision: 2026-06-15; resolution-model revision: 2026-06-16)
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

Three properties make a naive "just bundle everything" approach wrong here:

1. **It is a Node server, not a browser bundle.** Bundling a Node server's
   `node_modules` breaks ESM runtime semantics (`import.meta.url`, `__dirname`,
   `*.node` native addons) and is explicitly discouraged by both `tsup` and
   `esbuild` maintainers.
2. **There is exactly one native dependency (`argon2`) and Prisma v7.** Both
   are `node_modules` and must remain external; `argon2` additionally imposes a
   libc-match constraint on the build/runtime base images.
3. **Bundling first-party TS flattens the ~88-package boundary graph.** A single
   `dist/index.js` inlines workspace packages whose own transitive deps (e.g.
   `opossum`) are externalized; under pnpm's default ISOLATED layout those
   transitive deps are not reachable from the flattened artifact, forcing a
   HOISTED prod `node_modules` (a second, lower-quality module layout). It also
   carries esbuild's Prisma-7 namespace-bundle defect and tree-shaking risk
   across ~50 dynamic imports. The boundary graph is an asset (it is what makes
   the codebase hexagonal); the build should preserve it, not collapse it.

## Decision

Adopt a **TRANSPILE-ONLY** production build model with one principle:
**each workspace package and app compiles to its OWN `dist/*.js` via `tsc`;
`exports` point at `dist`; the prod `node_modules` is the pnpm ISOLATED layout
(no hoisting); 100% of `node_modules` stays external.**

There is **no bundler**. Each package preserves its boundary; the runtime
resolves a bare `@core/X` import through the pnpm symlink farm
(`node_modules/@core/X` → `packages/core/X`) → that package's `exports` → its
`dist`. This eliminates the hoisting requirement, the esbuild-Prisma namespace
defect, and tree-shaking risk for free, and is the standard monorepo
convention. `@infra/prisma` is no longer a "special externalized case" — it is
one of the compiled packages (it keeps `prisma generate` ahead of its `tsc`
emit because it includes the generated client).

### 1. Build tool and configuration (all workspace packages + `apps/api`, `apps/workers`)

Use **`tsc` project references** (`tsc -b`), driven by turbo:

- Each package gets a `tsconfig.build.json`: `composite: true`, `outDir: ./dist`,
  `rootDir: ./src`, `module`/`moduleResolution: NodeNext`, `target: ES2023`,
  `declaration: true`, and `references: [...]` to the `tsconfig.build.json` of
  each of its DECLARED workspace dependencies. The build config resets `paths`
  to `{}` so cross-package types resolve via the emitted `.d.ts` (through the
  package `exports`), not via the dev source aliases. The existing `tsconfig.json`
  (dev, `noEmit`, `paths` → `src`) is kept untouched for the editor / `typecheck`.
  **NOTE (revised 2026-06-16):** tsconfig `paths` alone does NOT make `tsx` /
  `node --import tsx --test` / `vitest` resolve workspace packages to source for
  BARE specifiers — `paths` is a type/bundler-time hint, and Node's own `exports`
  resolver (which those runners use for bare specifiers) ignores it. The accurate
  dev/test/CI resolution model is the two-mechanism contract in **§1c** below
  (conditional `exports` `development`→src + `--conditions development` for the
  Node runners; build-dist-first for the Turbopack boundary). The earlier
  "dev still resolves to source via paths" wording was incomplete and is
  superseded by §1c.
- A root solution-style `tsconfig.build.json` `references` every package + app;
  `tsc -b` builds the whole graph in topological order (the package boundary
  graph is ACYCLIC — see §1b — so the references form a valid DAG). The apps are
  terminal (`composite: false`, `declaration: false`): nothing references their
  `.d.ts`.
- Per-package `package.json`: `build` → `tsc -b tsconfig.build.json`; keep
  `typecheck` → `tsc --noEmit`; `main`/`types`/`exports` → `dist`.
- NodeNext requires explicit file extensions on relative + bare-subpath
  specifiers; a repo-wide codemod adds `.js` (non-breaking for dev — bundler-mode
  `tsc`/`tsx` accept the explicit `.js` on `.ts` source). Two CJS/alias
  NodeNext-strictness fixes are part of the same pivot: ioredis is imported as
  the named `import { Redis } from "ioredis"` (the default import resolves to a
  namespace under NodeNext), and the dev-only `@shared/<x>` path aliases are
  rewritten to the canonical `@shared/types/<x>.js` (the package is named
  `@shared/types`).

Per-app build output: `apps/api` → `dist/index.js`; `apps/workers` →
`dist/bootstrap.js` (+ the standalone worker entries as separate emitted files).

### 1b. Hexagonal cycle-break that made transpile-only viable (prerequisite)

Per-package isolated compilation + project references require an ACYCLIC,
fully-declared package graph. Achieving it required a hexagonal-canon cleanup,
committed ahead of this build pivot: `GatewayAdapterRegistryPort` was moved out
of `@core/domain` into `@ports/core` to break the `@ports/core ⇄ @core/domain`
cycle, every undeclared cross-package import edge was declared as a
`workspace:*` dependency, and one deep-relative cross-package import
(`@providers/x` reaching into `../../../core/threading/src`) was converted to a
proper `@core/threading` package import (CLAUDE.md tripwire #3). `scripts/depscan.mjs`
gates "0 undeclared edges, ACYCLIC".

### 1c. The dev/test/CI resolution model — a TWO-MECHANISM contract (revised 2026-06-16)

The transpile-only pivot pointed every package's `exports` UNCONDITIONALLY at
`./dist`. That is correct for the production image (which builds `dist` first),
but it leaks a production decision into dev/test/CI, where `dist` is NOT built.
The earlier framing ("dev/test resolve to source via tsconfig `paths`") is FALSE
for Node's own `exports` resolver: only `tsc` and `vitest` (via the bespoke
`buildWorkspaceAliases` alias factory in `vitest.shared.ts`) read tsconfig
`paths`; for BARE workspace specifiers, `tsx` and `node --import tsx --test`
defer to Node ESM `exports` and land on `dist` → `ERR_MODULE_NOT_FOUND` against
an unbuilt tree. Empirically reproduced on PR #91 (the Prisma seed →
`@observability/logger`; the security `node:test` suites →
`@infra/prisma/extensions/tenantGuard.js`; the Next size-limit job →
`@shared/types/i18n/createRequestConfig`). No single mechanism fixes all
consumers — Turbopack cannot honor custom export conditions (vercel/next.js
Discussion #78912, OPEN). The resolution model is therefore TWO coordinated
mechanisms plus one orthogonal config rule:

**(B-CORE) Conditional `exports` `development`→src + `--conditions development`
for the Node-family runners.** Every transpile-only package's `exports` carries
a `development`→src branch ordered FIRST (Node key order is significant —
most-specific first, `default` always LAST), mirrored on the root AND every
subpath. The branch is STRICTLY ADDITIVE and INERT by default: the four core
conditions (`node`/`default`/`import`/`require`) always apply, so production
keeps resolving `default`→dist and the `development` branch is selected ONLY when
a consumer opts in via `--conditions development`. Source consumers opt in by
passing `--conditions development` **on the invocation** (NOT `NODE_OPTIONS` —
GitHub Actions restricts it from `GITHUB_ENV`; NOT tsconfig `customConditions`
alone — `tsx` does not auto-read it, tsx#574). Covered invocations: the
`@infra/prisma` `seed` script, the `apps/api` `test:auth`/`test:rbac`/`test:security`
(+ sibling `node --import tsx --test`) scripts, and the `node --import tsx --test`
invocation in `apps/api/scripts/run-tests.sh`. Authored by the idempotent codemod
`scripts/migrations/add-development-condition.mjs`. `@shared/types` is EXCLUDED
from B-CORE (it is the Turbopack boundary — see B-NEXT). Node 24 honors
`-C/--conditions` as a CLI flag (verified `process.allowedNodeEnvironmentFlags.has('--conditions')`).

**(B-NEXT) Build-dist-first for the Turbopack boundary (`@shared/types`).**
Turbopack ignores custom export conditions and cannot resolve `@shared/types`'s
NodeNext `.js`-specifier'd source, so `@shared/types` is consumed as `dist` by
the Next apps (the deliberate Option-B `@shared/types*`→dist tsconfig-paths
mapping, §4(b)) and its `dist` MUST be built before EVERY `next build`. The
Dockerfile build stages already do this (`pnpm --filter @shared/types... build`
precedes `next build`); the CI `size-limit (bundles)` job (`.github/workflows/audit.yml`)
must use `turbo run build --filter=@apps/admin --filter=@apps/client` so turbo's
`build.dependsOn:["^build"]` expands `@shared/types#build` first. GOTCHA: `tsc -b`
is incremental — a stale `tsconfig.build.tsbuildinfo` makes the rebuild a no-op;
CI's clean checkout has none, so turbo's output tracking is safe, but a local
prebuild must clean the cache.

**(Cluster A) Config files are EXCLUDED from every package/app `tsc`/typecheck
graph.** A package-root or app-root `vitest.config.ts` swept into a `tsc --noEmit`
/ `next build` typecheck pass drags in `vitest/config` + the cross-rootDir
`../../vitest.shared.ts` from the monorepo root (where `vitest` is not installed)
→ TS2307 / TS6059 / TS6307. Rule: the Next apps MUST `exclude` `vitest.config.ts`
from their tsconfig (both `apps/admin` and `apps/client` now do), and package
build tsconfigs MUST scope `include: ["src/**/*"]`. Adding a `vitest` devDependency
alone is NOT sufficient — exclusion from the build graph is the decisive part.

**What MUST NOT regress** (additive change): the `vitest.shared.ts`
`buildWorkspaceAliases` factory stays (vitest still resolves src via its alias —
collapsing onto `ssr.resolve.conditions` is a separate, independently-verified
follow-up); production `default`→dist is unchanged; fitness #26 stays at zero
(the `development`→src mappings live in `package.json` `exports`, not import
statements, and target backend/NodeNext packages).

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

### 3b. `@infra/prisma` — one of the compiled packages (transpile-only)

Under transpile-only `@infra/prisma` is no longer a special "externalized"
case — it is a normal compiled package, with one wrinkle: it includes the Prisma
7 generated client, so its build runs `prisma generate` ahead of `tsc`
(`build = "prisma generate && tsc -p tsconfig.build.json"`), and its
`tsconfig.build.json` uses `rootDir: "."` (it `include`s `generated/**` outside
`src/`), emitting to `dist/src/index.js` with `exports`/`main` → `./dist/src/...`.
`tsc` handles the generated client's `import * as Prisma` `export *` namespace
re-export fine (the defect was esbuild-specific), and `Prisma.sql` (a runtime
value) survives. It is a referenced project in the solution graph like every
other package. Dev/test/CI resolve `@infra/prisma` (incl. its `./extensions/*`
and `./*` subpaths) → `src/*.ts` via the `development`→src conditional `exports`
branch + `--conditions development` on the source-mode invocation, NOT via
tsconfig `paths` (see §1c — the `extensions` subpath is the exact case the vitest
alias factory had to special-case, and `node:test` had no equivalent until B-CORE).

**Isolated production node_modules (no hoisting).** Because nothing is bundled,
the prod `node_modules` is the pnpm DEFAULT isolated layout — each consumer's
`@scope/pkg` symlink is consumer-local (`apps/api/node_modules/@core/X`,
`packages/<p>/node_modules/@core/X`) and links into the central `.pnpm` store.
The image ships the whole built+pruned workspace tree (every package's `dist` +
nested `node_modules` + the root store) from one stage so the symlink farm stays
internally consistent. No `node-linker=hoisted`, no `pnpm deploy`.

### 4. admin / client (Next 16 standalone, separate toolchain)

Next.js is a distinct toolchain (`output: "standalone"`), bundled by **Turbopack**
(the Next 16 default) — NOT part of the transpile-only `tsc` build. Two cross-cutting
constraints govern it; both were root-caused in the next-dev-resolution RCA
(branch `workstream/next-dev-resolution`, 2026-06-15) and **revise the earlier
framing of this section**.

**(a) `turbopack.root` must be an ancestor of the app, the `packages/ui` source it
imports, AND the pnpm store where `next` resolves.** Turbopack bounds module
resolution to `turbopack.root` and follows realpaths. With `pnpm-workspace.yaml`
`enableGlobalVirtualStore: true`, `next` symlinks out to `$HOME/.local/share/pnpm/store`
— OUTSIDE the monorepo root — so a **monorepo-root** `turbopack.root` makes Turbopack
unable to resolve `next` in DEV ("Next.js inferred your workspace root… couldn't find
next/package.json"). Resolution: default `turbopack.root` / `outputFileTracingRoot` to
**`os.homedir()`** (dev/CI: home is an ancestor of both the repo and the store), and set
**`NEXT_TURBOPACK_ROOT=/app`** in the Docker build stage (container runs as root,
home=/root is not an ancestor of `/app/apps/admin` → `Invalid distDirRoot`; `/app` is).
So `os.homedir()` is CORRECT for dev/CI (the earlier "os.homedir breaks Docker" framing
held only because Docker lacked the env override). `next build --webpack`
(`NEXT_BUILD_FLAGS`) remains the fallback for the open turbopack-root/distDirRoot bug
(#86438 / #88579); the Next patch version stays pinned.

**(b) The NodeNext `.js`-extension convention is BACKEND-ONLY; bundler-compiled
frontend code is extensionless.** The §1 `.js`-extension codemod is required for
NodeNext production emit (api, workers, `@core/*`, NodeNext-built packages) but
Turbopack CANNOT resolve a written `./x.js` back to its `./x.ts` source — no config
does this (vercel/next.js #82945 OPEN). So `.js` on relative imports is WRONG for
Turbopack-compiled frontend: `apps/admin`, `apps/client`, and the frontend-only
packages they compile from src (`@packages/ui`, `@packages/api-errors`,
`@packages/query-client`, `@observability/browser-logger`) use `moduleResolution:
bundler` and stay extensionless. The Next apps REMAIN on Turbopack (the `.js` was
stripped from frontend code, the apps were NOT switched to webpack). **A package
consumed by BOTH halves (`@shared/types`: ~617 backend NodeNext consumers + the Next
frontend) ships a build: the frontend resolves it via its prebuilt `dist`** (where
`.js` points to real emitted `.js`), NOT its src — the apps' tsconfig `paths` map
`@shared/types` → `packages/shared/dist`, and the Dockerfile / `predev` build
`@shared/types` before `next build` / `next dev`. A fitness check forbids `.js`-on-`.ts`
relative imports in the frontend dirs so a future path-agnostic codemod cannot re-break
Turbopack.

`COPY` `public` + `.next/static` manually into the standalone output; never
`pnpm install` inside `.next/standalone`.

## Rationale

1. **The monorepo convention for a Node server is transpile-only with preserved
   package boundaries.** Both `tsup` and `esbuild` documentation state that
   bundling a Node server's deps is unnecessary and can break ESM; the
   corollary here is that bundling first-party TS too (to collapse path aliases)
   is also unnecessary once each package emits its own `dist` + `exports`. The
   pnpm isolated layout + per-package `tsc` emit is the standard shape and
   removes the hoisting/tree-shaking/esbuild-Prisma problems for free.
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

- **Bundle first-party TS with tsup/esbuild, externalize `node_modules`
  (the prior decision).** ❌ Rejected (transpile-only revision). Collapsing the
  ~88 workspace packages into one `dist/index.js` per app FLATTENS the boundary
  graph and forces a HOISTED prod `node_modules`: the inlined packages'
  externalized transitive deps (e.g. `opossum`) are unreachable under pnpm's
  isolated layout from a flattened artifact, so the prod stage needed
  `node-linker=hoisted` (a second, lower-quality module layout that diverges from
  dev). It also requires an `onResolve` esbuild plugin to special-case
  `@infra/prisma` out of the bundle (esbuild cannot bundle the Prisma 7
  `import * as Prisma` namespace re-export — build error `No matching export`,
  plus runtime crashes prisma#27324 `fileURLToPath`, #28126 `node:path`), and
  carries tree-shaking risk across ~50 static-string dynamic imports + the Proxy
  prisma singleton. The one-file-artifact win is modest for a server image. tsup
  and esbuild maintainers both state bundling a Node server is usually
  unnecessary. Transpile-only removes all of these problems at the cost of a
  multi-file image (fine for a server). This is why the build is now
  transpile-only; the hexagonal cycle-break (§1b) was the prerequisite that made
  per-package isolated compilation possible.
- **Bundle `node_modules` too (single self-contained file).** ❌ Rejected.
  Breaks ESM runtime semantics (`import.meta.url`, `__dirname`, native `.node`
  addons like `argon2`). Explicitly discouraged by tsup and esbuild
  maintainers for Node servers.
- **Keep running `tsx` in production.** ❌ Rejected. Ships the TypeScript
  toolchain and source into the runtime image, defeats the distroless minimal
  runtime, and pays per-request transpilation cost. The whole point of this
  change is to have a real JS-emit production path.
- **Per-package independent `tsc` (no project references).** Considered.
  Each package can build independently (cross-package types resolve via the
  already-emitted `.d.ts` once deps are built). Project references (`tsc -b`)
  were chosen instead because they give correct topological build ordering and
  incremental rebuilds from a single root solution config, and the acyclic graph
  makes the references valid by construction.

## Consequences

**Positive**

- The four production images can build for the first time; the runtime stages
  receive the JS artifacts they already expect.
- The paused `containerization-image-hardening` tail
  (Trivy/pins/mirror/hadolint/promote) can resume on top of building images.
- The distroless runtime stays minimal: no `tsx`, no TypeScript toolchain, no
  source.

**Negative / costs**

- A larger, multi-file image: every workspace package ships its `dist` + nested
  `node_modules` symlinks (accepted — fine for a server image; the win is
  preserved boundaries + isolated layout).
- Per-package `tsconfig.build.json` + `package.json exports` to keep in sync
  (generated by `scripts/migrations/gen-build-projects.mjs`, derived from the
  acyclic dependency graph — regenerable).
- The Next.js standalone path carries an open-bug workaround (webpack fallback
  - Next version pin) until upstream #86438 is fixed.
- Real emit (the packages were `--noEmit` before) can surface latent type/emit
  issues in code never previously typechecked (e.g. `@providers/facebook`'s
  unreachable `analytics`/`media`/dead-`features` modules, excluded from the
  build the same way the dev tsconfig excluded them). Fixed at the root, never
  with `@ts-ignore`.

## Revisit if

- Upstream Next.js fixes the turbopack-root/distDirRoot interaction (#86438)
  → drop the webpack fallback and re-evaluate the version pin.
- A second native dependency is added → re-confirm the libc-match constraint.
- The package count or boundary graph changes materially → re-run
  `gen-build-projects.mjs` + `depscan.mjs` (acyclic gate).
- The `development` `exports` condition (§1c, B-CORE) proves stable → collapse
  vitest onto `ssr.resolve.conditions: ["development","import","default"]` and
  retire `buildWorkspaceAliases` (separate, independently-verified change; keep
  the alias as fallback until proven equivalent — Prisma 7 Node-vs-browser entry,
  the `@infra/prisma/extensions` special-case, dual-package hazard each need their
  own verification run).

## Risks and Mitigations

| Risk                                                                             | Mitigation                                                                                                                                     |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Project references require an acyclic, fully-declared graph                      | `scripts/depscan.mjs` gates "0 undeclared edges, ACYCLIC"; the hexagonal cycle-break (§1b) committed ahead.                                    |
| Next.js turbopack root/distDirRoot bug (#86438 OPEN, no fix)                     | `next build --webpack` fallback + pinned Next patch version; env-aware `turbopack.root`.                                                       |
| musl/glibc ABI mismatch for `argon2`                                             | Deps/builder stage on `node:24-bookworm-slim` (glibc) to match distroless-debian runtime.                                                      |
| Prisma v7 generated client not shipped                                           | `@infra/prisma` compiles it (`prisma generate` before `tsc`); the whole `infra/` tree ships into runtime; no engine-binary step.               |
| `@t3-oss/env-core` fail-fast still runs at module load                           | Smoke-boot each artifact (verified: `node apps/{api,workers}/dist/...` fail only on DB connect, env validated).                                |
| Isolated symlink farm incomplete in the image (consumer-local node_modules lost) | Ship the whole built+pruned workspace tree (root + every nested `node_modules` + every `dist`) from one stage; smoke-boot confirms resolution. |

## References

- TypeScript — Project References (`tsc -b`):
  https://www.typescriptlang.org/docs/handbook/project-references.html
- TypeScript — ESM/NodeNext module resolution (explicit extensions):
  https://www.typescriptlang.org/docs/handbook/modules/reference.html#node16-nodenext
- pnpm — workspaces + isolated node-linker (no hoisting):
  https://pnpm.io/workspaces
- esbuild — bundling for Node (externalize node_modules), context for why a Node
  server need not be bundled:
  https://esbuild.github.io/getting-started/#bundling-for-node
- node-argon2 (native dep, libc constraint): https://github.com/ranisalt/node-argon2
- distroless base images: https://github.com/GoogleContainerTools/distroless
- Prisma v7 upgrade guide: https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7
- Prisma — deployment with Docker: https://www.prisma.io/docs/guides/deployment/docker
- Next.js `output: "standalone"`:
  https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- Next.js Turbopack config: https://nextjs.org/docs/app/api-reference/turbopack
- Next.js #86438 — turbopack root / `Invalid distDirRoot` (OPEN):
  https://github.com/vercel/next.js/discussions/86438
- Node — Conditional exports + Conditions Definitions (`development` community
  condition, key order, `-C`/`--conditions`): https://nodejs.org/api/packages.html
- Node CLI — `-C, --conditions`: https://nodejs.org/api/cli.html
- TypeScript — `customConditions` (resolve to source `.ts` in monorepos):
  https://www.typescriptlang.org/docs/handbook/modules/reference.html
- tsx #574 — `--conditions` CLI flag, does not auto-read tsconfig customConditions:
  https://github.com/privatenumber/tsx/issues/574
- vercel/next.js Discussion #78912 — Turbopack cannot enforce export conditions (OPEN):
  https://github.com/vercel/next.js/discussions/78912
- GitHub Actions — NODE_OPTIONS restricted from GITHUB_ENV:
  https://github.blog/changelog/2023-10-05-github-actions-node_options-is-now-restricted-from-github_env/
