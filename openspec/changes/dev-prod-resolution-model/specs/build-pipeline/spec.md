# Build Pipeline — Delta Spec

> Delta spec for change `dev-prod-resolution-model`. Capability: **the Next/Turbopack
> build boundary, the package tsc graph, and the no-regression invariants**. Covers the
> mechanisms a single export-condition cannot fix (Turbopack ignores custom conditions)
> plus the orthogonal Cluster-A config-exclusion rule.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each requirement carries
> Given/When/Then acceptance scenarios. Scenarios marked **[empirical]** were reproduced
> in the RCA.

---

## ADDED Requirements

### Requirement: `@shared/types` dist is built before every `next build` (the Turbopack boundary)

Turbopack cannot honor custom export conditions (vercel/next.js Discussion #78912, OPEN,
maintainer-confirmed) and cannot resolve `@shared/types`'s NodeNext `.js`-specifier'd
source. Therefore `@shared/types` MUST be consumed as **`dist`** by the Next apps (the
deliberate Option-B `@shared/types*`→`dist` tsconfig-paths mapping is preserved), and
`@shared/types`'s `dist` MUST be **built before** any `next build` runs. This guarantee
MUST hold for **every** `next build` invocation: the `size-limit (bundles)` CI job in
`.github/workflows/audit.yml` and the Dockerfile build stage.

#### Scenario: size-limit job builds @shared/types before the apps [empirical]

- **Given** the `size-limit (bundles)` job builds `apps/admin` and `apps/client`
- **And** `apps/admin/i18n/request.ts` imports `@shared/types/i18n/createRequestConfig`
- **When** the job runs
- **Then** `@shared/types#build` runs first (via turbo `^build` expansion, a `@shared/types...` filter selector, or an explicit `@shared/types` prebuild step) so `packages/shared/dist` exists
- **And** `@shared/types/i18n/createRequestConfig` resolves to `packages/shared/dist/i18n/createRequestConfig.js`
- **And** Turbopack reports **zero** `Module not found: Can't resolve '@shared/types/...'`

#### Scenario: Dockerfile build stage builds shared dist before next build

- **Given** the Dockerfile build stage runs `next build` for an app that imports `@shared/types/*`
- **When** the stage executes
- **Then** `@shared/types`'s `dist` is built before the `next build` step
- **And** the app's `@shared/types/*` imports resolve to `dist`

#### Scenario: The main Build Check ordering is not regressed

- **Given** the main CI "Build Check" job already builds `@shared/types` dist via turbo `^build` (`pnpm build` = `turbo run build`, `dependsOn: ["^build"]`)
- **When** this change adds the same guarantee to the `size-limit` job and the Dockerfile
- **Then** the existing `^build` ordering in "Build Check" is left intact (only the missing guarantees are added, the working one is not changed)

---

### Requirement: Config files never enter a package or app tsc/typecheck graph (Cluster A)

A package-root or app-root `vitest.config.ts` MUST NOT be compiled by any `tsc --noEmit`
or `next build` typecheck pass. Such a file imports `vitest/config` and the cross-rootDir
`../../vitest.shared.ts` from the monorepo root where `vitest` is not installed, producing
`TS2307` / `TS6059` / `TS6307`. The rule: Next apps MUST `exclude` `vitest.config.ts` from
their tsconfig; package build tsconfigs MUST scope `include` to `["src/**/*"]` so a
package-root `vitest.config.ts` is never swept in. (Adding a `vitest` devDependency alone
is **not** sufficient — exclusion from the build graph is the decisive part.)

#### Scenario: apps/client next build no longer typechecks the root vitest.config.ts [empirical]

- **Given** `apps/client/vitest.config.ts` exists at the app root and imports `vitest/config` + `../../vitest.shared.ts`
- **And** `apps/client/tsconfig.json` excludes `vitest.config.ts` (matching the asymmetry `apps/admin` already has)
- **When** `apps/client` `next build` runs its typecheck pass
- **Then** `vitest.config.ts` is not in the typecheck graph
- **And** there is **zero** `Cannot find module 'vitest/config'` (`TS2307`) error from `../../vitest.shared.ts`
- **And** `@apps/client#build` exits 0 on the Cluster-A failure mode

#### Scenario: Package build tsconfig scopes include to src

- **Given** a workspace package that carries a root `vitest.config.ts`
- **And** its build tsconfig sets `include: ["src/**/*"]`
- **When** `tsc --noEmit` (or `tsc -b`) runs for that package
- **Then** the package-root `vitest.config.ts` is not compiled
- **And** `--listFilesOnly` shows only the `src` files (no `vitest.config.ts`, no `../../vitest.shared.ts`)
- **And** the package build exits 0

---

## MODIFIED Requirements

### Requirement: No green surface regresses

The change is additive. The surfaces that are green at HEAD `d6a3be90` MUST remain green
after the change. Specifically: vitest's existing alias→src resolution, the Frontend Tests
suite, Next dev under Turbopack, fitness **#26**, and production `default`→`dist`
resolution MUST all be unaffected.

#### Scenario: Vitest still resolves via its alias factory [empirical]

- **Given** `vitest.shared.ts`'s `buildWorkspaceAliases` factory is left untouched by this change
- **When** the vitest suites run
- **Then** workspace packages still resolve to `src` via `resolve.alias`
- **And** the alias factory is **not** deleted (collapsing vitest onto `ssr.resolve.conditions` is an out-of-scope, separately-verified follow-up; the alias remains as the working fallback)

#### Scenario: Frontend Tests pass unchanged

- **Given** no frontend source file and no test config is touched by this change
- **When** the Frontend Tests suite runs
- **Then** it passes as before

#### Scenario: Next dev under Turbopack still works with Option B

- **Given** the `@shared/types*`→`dist` tsconfig-paths mapping (Option B) and extensionless/bundler resolution are preserved
- **When** `next dev` runs under Turbopack
- **Then** it resolves `@shared/types/*` to `dist` exactly as before
- **And** `@shared/types` is **not** source-resolved via a condition (Turbopack ignores it)
- **And** no `.js` specifiers are added to `@shared/types`'s source for Next

#### Scenario: Fitness #26 stays at zero [empirical]

- **Given** the `development`→`src` mappings live in `package.json` `exports` (not in import statements) and target backend/NodeNext packages
- **And** the change adds no relative `.js`-on-`.ts` imports in the bundler-compiled frontend dirs (`apps/admin`, `apps/client`, `packages/ui/src`, `packages/api-errors/src`, `packages/query-client/src`, `packages/observability/browser-logger/src`)
- **When** fitness check #26 runs
- **Then** its count is **0** (unchanged)

#### Scenario: All other fitness functions remain hard-zero

- **Given** the 26 CI fitness functions are each hard-zero at the change's start
- **When** the change is applied (config-only: `package.json` exports, tsconfig, CI scripts, Dockerfile)
- **Then** each of the 26 fitness functions remains at its hard-zero count

---

## Verification note (strict TDD — config-dominant change)

This change is predominantly **configuration** (`package.json` `exports`, app/package
`tsconfig`, CI scripts, the size-limit job, the Dockerfile build stage), so there is little
production TypeScript to drive RED→GREEN. The "tests" are the **resolution scenarios above
run against an unbuilt tree**, and they are the literal pass/fail bar:

- **RED proof**: with `dist` deliberately absent and no `development` branch, the seed and
  security `node:test` consumers fail with `ERR_MODULE_NOT_FOUND` (reproduced).
- **GREEN proof**: with the `development`→`src` branch added and `--conditions development`
  passed, the same consumers resolve from `src` with zero module-resolution errors, while
  production (`default`→`dist`, no flag) is unchanged.

LXC constraints apply to any executed scenario: run a **single** resolution scenario file,
heap-capped (`--max-old-space-size`), under a `timeout` wrapper. Never run the full suite
at once. If any helper code is introduced (none expected), it carries tests + JSDoc per
canon.
