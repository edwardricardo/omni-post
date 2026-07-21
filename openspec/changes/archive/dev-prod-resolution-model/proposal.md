# Proposal — dev-prod-resolution-model

> SDD proposal artifact. Inputs: a 5-agent canon-backed, empirically-verified RCA
> (dist deliberately removed to force the failure; fix applied; consumers resolved).
> This proposal does not re-explore — it commits the decision. Spec + design follow.

- **Change**: `dev-prod-resolution-model`
- **Artifact store**: `openspec` (this file is committable)
- **Mode**: interactive (orchestrator pauses after this phase before spec)
- **Status**: proposed
- **Date**: 2026-06-16
- **Branch context**: `workstream/next-dev-resolution` (PR #91, OPEN, HEAD `d6a3be90`)

---

## 1. Intent — what problem, why now, what success looks like

### The problem

The transpile-only pivot (ADR-0017) flipped **every** workspace package's `package.json`
`exports` to point **UNCONDITIONALLY at `./dist`**. That is correct for the production
image (which builds `dist` first), but it leaks a production decision into dev/test/CI,
where `dist` is **not built**.

ADR-0017's stated dev model — _"dev/test resolve to source via tsconfig `paths`"_ — is
**FALSE for Node's own `exports` resolver**. Only `tsc`, `tsx` (for local-file `.js`→`.ts`
rewriting), and `vitest` (via the bespoke `buildWorkspaceAliases` alias factory in
`vitest.shared.ts`) read tsconfig `paths`. For **bare workspace specifiers**, `tsx` and
`node --import tsx --test` defer to Node ESM `exports` and land on `dist`. The moment a
consumer touches a workspace package by its bare specifier against an unbuilt tree, it gets
`ERR_MODULE_NOT_FOUND .../dist/...`.

The vitest alias factory only ever covered vitest. **Zero of the 78 transpile-only packages
carry a `development` condition.** No canon doc establishes a dev/test/CI resolution model
that covers non-vitest runners.

Three CI surfaces are red on this exact failure (empirically reproduced at HEAD `d6a3be90`):

| # | Surface | Runner | Failure |
| --- | ------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| 1 | Seed (`infra/prisma/seed.ts`) | `tsx seed.ts` | `ERR_MODULE_NOT_FOUND .../@observability/logger/dist/index.js` |
| 2 | Security suites (`tests/auth   | rbac                   | security.test.ts`) | `node --import tsx --test` | `ERR_MODULE_NOT_FOUND .../@infra/prisma/dist/src/extensions/tenantGuard.js` |
| 3 | Next build (`apps/admin` i18n) | Turbopack `next build` | `Module not found: @shared/types/i18n/createRequestConfig` (a **different** mechanism — see §3) |

Mechanism 2 hits the exact `@infra/prisma/extensions` subpath that the vitest factory had to
special-case (`vitest.shared.ts:102`) — and `node:test` got no equivalent.

### Why now

The red CI blocks PR #91 and any merge on `workstream/next-dev-resolution`. The failure is
**latent for every package not yet consumed by a non-vitest surface** — it will recur silently
the next time a new seed/tooling/`node:test` consumer touches an unbuilt package. This is a
systemic resolution-model gap, not three isolated bugs.

### Success criteria

- The two failing Node-family consumers (seed + security `node:test`) **resolve from source**
  with `dist` absent — proven empirically (seed reached `prisma.account.upsert` → P1001 DB-down
  is the expected stop point; security suite: 18 tests, 0 cancelled, **zero** module-resolution errors).
- The Next/`@shared/types` build resolves because `@shared/types#build` runs **before** every
  `next build` (CI `size-limit` job + Dockerfile build stage).
- Cluster A (config-file-in-tsc-graph) cleared: `@apps/client#build` (`next build` typecheck) green.
- **Production resolution is unchanged** (`default`→`dist`; the `development` branch is inert
  unless `--conditions development` is passed, never passed in the runtime container).
- **Nothing green regresses** (§4).

---

## 2. Scope

### In scope

**B-CORE — conditional `exports` on ALL transpile-only packages (Edward's decision: uniform, all 78).**

Add a `development`→`src` branch to the `exports` of **all ~78 transpile-only workspace
packages** — not just the 2 currently-failing consumers (`@observability/logger`,
`@infra/prisma`; `@packages/api-common` is latent today). Uniform application prevents the
identical failure recurring later for a package not yet consumed by a non-vitest surface.

- The branch is ordered **BEFORE** `default`→`dist` (Node: key order is significant,
  most-specific first, `default` always last) and **mirrored on every subpath** (root `.`,
  `./extensions/*`, `./*`, etc. — not just the root).
- Strictly **additive**: production keeps `default`→`dist`; the four core conditions
  (`node`/`default`/`import`/`require`) always apply; the `development` branch is inert unless requested.
- Opt-in is passed **on the invocation** via `--conditions development` — **NOT** `NODE_OPTIONS`
  (GitHub Actions restricts `NODE_OPTIONS` from `GITHUB_ENV`; and `tsx` does **not** auto-read
  tsconfig `customConditions`, so the flag must be on the command).

**CI / script touchpoints for `--conditions development`** (every dev/test/CI **source** consumer):

- The Prisma seed: `tsx --conditions development infra/prisma/seed.ts` (the `@infra/prisma` `seed` script).
- The security `node:test` scripts (`test:auth` / `test:rbac` / `test:security`):
  `node --conditions development --import tsx --test ...`.
- `apps/api/scripts/run-tests.sh` (the integration `node --import tsx --test` invocations).

**B-NEXT — `@shared/types` stays dist-via-tsconfig-paths (Option B), built before any Next build.**

`@shared/types` **cannot** use the development condition — Turbopack ignores custom export
conditions (vercel/next.js Discussion #78912, OPEN, maintainer-confirmed). Its src is NodeNext
`.js`-specifier'd, which Turbopack can't eat. So keep the Option-B `@shared/types*`→`dist`
tsconfig-paths mapping in the Next apps and **guarantee dist-built-first**:

- Fix the `size-limit (bundles)` job in `.github/workflows/audit.yml` so `@shared/types#build`
  runs before the apps build (turbo `^build` / `pnpm --filter @shared/types... ...` / explicit prebuild step).
- Ensure the Dockerfile build stage builds `@shared/types` before any `next build` too.

**Cluster A — config files must not enter any package/app tsc graph (orthogonal to resolution).**

- Add `vitest.config.ts` to `apps/client/tsconfig.json` `exclude` (`apps/admin` already excludes it;
  the asymmetry is the entire Cluster-A failure — `next build`'s typecheck sweeps the root
  `vitest.config.ts`, which imports `vitest/config` + `../../vitest.shared.ts` from the monorepo
  root where `vitest` is not installed).
- Ensure package build tsconfigs scope `include: ["src/**/*"]` so `tsc --noEmit` never compiles a
  package-root `vitest.config.ts`.

### Out of scope (named follow-ups — do NOT do them in this change)

1. **Collapse vitest onto `ssr.resolve.conditions`** (retire `buildWorkspaceAliases`). Once exports
   carry `development`, vitest _can_ collapse onto `ssr.resolve.conditions: ["development","import","default"]`.
   Do it as a **separate, independently-verified** change; **keep the alias factory as fallback** —
   do NOT drop the working alias in this change (dual-package hazard, Prisma 7 Node-vs-browser entry,
   the `@infra/prisma/extensions` special-case all need their own verification run).
2. **`@packages/api-common` Package Tests failure** (`No "Redis" export on the ioredis mock`) — a
   separate vitest bug, unrelated to dist-resolution. Tracked independently; must not be conflated here.
3. **ADR-0017 amendment** — required as this change's **closure** (canon currently codes a binary
   "prod=dist / dev=paths" model; the real model is two-mechanism: conditional-exports for Node runners
   - build-dist-first for the Turbopack boundary, plus the Cluster-A config-exclusion rule). The amendment
     is mandatory but is a documentation artifact authored at apply/archive, not a code change in this slice.
4. **CI/fitness guard** asserting (a) every `next build` depends on `@shared/types#build`, and
   (b) every source-mode `node`/`tsx` invocation passes `--conditions development`. Recommended as a
   follow-up so the two invariants can't silently regress.

---

## 3. Approach — two coordinated mechanisms, with rationale

**No single mechanism covers all consumers** — Turbopack cannot honor custom export conditions
(vercel/next.js #78912). So the change is two coordinated mechanisms plus an orthogonal Cluster-A fix.

### B-CORE — conditional exports + `--conditions development` (the Node-family runners)

```jsonc
// every transpile-only package's exports — additive `development` branch, ordered before default
".":            { "development": "./src/index.ts",      "types": "./dist/index.d.ts",     "default": "./dist/index.js" }
// @infra/prisma also mirrors subpaths:
".":            { "development": "./src/index.ts",      "types": "./dist/src/index.d.ts", "default": "./dist/src/index.js" }
"./extensions/*": { "development": "./src/extensions/*",                                  "default": "./dist/src/extensions/*" }
"./*":          { "development": "./src/*",                                               "default": "./dist/src/*" }
```

**Rationale**: this is the community-blessed shape — Node lists `development`/`production` as
official Community Conditions; TS documents `customConditions` precisely "so TypeScript resolves
to the source `.ts` instead of compiled `.js`." It **replaces per-runner fragmentation with one
Node-resolver mechanism** that covers `tsx` + `node:test` + (optionally) tsc at once. Empirically
proven: with `development`→src added and dist moved aside, the seed resolved `@observability/logger`
and the security `node:test` resolved `@infra/prisma/extensions/tenantGuard.js` from src (18 tests,
0 cancelled, zero module-resolution errors).

### B-NEXT — build-dist-first for the Turbopack boundary (`@shared/types`)

**Rationale**: Turbopack ignores custom conditions and can't resolve `@shared/types`'s NodeNext
`.js` src specifiers, so source-resolution is impossible there. The only correct fix is to ensure
`packages/shared/dist` exists before any `next build`. The main CI "Build Check" job already does
(`pnpm build` = `turbo run build`, `dependsOn: ["^build"]`); the `size-limit` job and the Dockerfile
build stage do not, and that gap is mechanism 3. Gotcha to encode for any local/turbo prebuild:
`tsc -b` is incremental — a stale `tsconfig.build.tsbuildinfo` makes the rebuild a no-op; rely on
turbo's output tracking or a clean cache (CI's clean checkout is safe).

### Cluster A — config files out of every package/app tsc graph (orthogonal)

**Rationale**: a package-root `vitest.config.ts` swept into a `tsc --noEmit` / `next build`
typecheck pass drags in `vitest/config` + the cross-rootDir `../../vitest.shared.ts` from the
monorepo root, where `vitest` isn't installed → `TS2307` / `TS6059`/`TS6307`. Adding a `vitest`
devDep alone is **not** sufficient (api-errors already has it and still failed); excluding the
config from the build graph is the decisive part. Apps exclude `vitest.config.ts`; packages scope
`include: ["src/**/*"]`.

---

## 4. What MUST NOT regress

1. **Vitest alias→src** (`vitest.shared.ts buildWorkspaceAliases`): currently green. The
   conditional-export change is additive and does **not** touch the alias factory. Do **not** delete it here.
2. **Frontend Tests**: no frontend source touched, no test config changed.
3. **Next dev under Turbopack + `@shared/types`→dist (Option B)**: keep extensionless/bundler
   resolution and the `@shared/types*`→dist tsconfig mapping. Do **not** source-resolve `@shared/types`
   via a condition; do **not** add `.js` specifiers in shared's src for Next.
4. **Fitness #26** (no `.js`-on-`.ts` imports in bundler-compiled frontend dirs): the fix adds no
   relative `.js` imports in those dirs — the `development`→src exports live in `package.json`
   (not import statements) and target backend/NodeNext packages, so #26 stays at zero.
5. **Production resolution**: `default`→dist unchanged; `development` is opt-in, never passed in the
   runtime container.
6. The main "Build Check" job's existing `^build` ordering — only **add** the same guarantee to the
   `size-limit` job, do not regress the working one.

---

## 5. Strict TDD note (this change is largely config)

This change is predominantly **configuration** — `package.json` `exports`, app/package `tsconfig`,
CI scripts (`run-tests.sh`, test:auth/rbac/security, the size-limit job), and the Dockerfile build
stage. There is little production TypeScript to drive RED→GREEN. Verification applies as:

- **The previously-failing consumers MUST resolve** — the seed and the security `node:test` suite
  load their workspace modules from src with `dist` absent (the empirical proof points; DB-down /
  HTTP-server failures are acceptable, module-resolution errors are not).
- **Production resolution unchanged** — without `--conditions development`, every consumer still
  resolves `default`→dist (assert the `development` branch is inert).
- The spec/design phase will define the exact gates (which CI jobs must go green, the
  `--conditions` audit, the `@shared/types#build` ordering assertion). No new domain/application
  code is expected; if any helper is added, it carries tests + JSDoc per canon.

---

## Next recommended

- `sdd-spec` and `sdd-design` (can run in parallel — both read this proposal).
