# Delta for build-pipeline

> Change `testing-refoundation` (WU-6.E8, amendment A2). One ADDED requirement and one MODIFIED
> requirement. The MODIFIED block is the FULL requirement text from
> `openspec/specs/build-pipeline/spec.md` with the change applied, so the archive replaces it without
> losing a scenario.
>
> Cluster A is UNCHANGED: the rebuilt end-to-end tree enters the tests-typecheck programme, never an
> application build graph — so the "config files never enter a build graph" requirement and the "no
> green surface regresses" requirement are untouched and are deliberately NOT restated here.
>
> Scenario tags keep the living spec's meaning: **[empirical]** was reproduced in the original RCA.

---

## ADDED Requirements

### Requirement: The rebuilt end-to-end tree is typechecked, and only by the tests-typecheck programme

The rebuilt end-to-end tree MUST sit inside a typecheck scope: every end-to-end file MUST be covered by
the tests-typecheck programme and carry its key in that programme's baseline, so a type error in a spec
is a gate failure rather than a runtime surprise on the one browser job. Renames MUST be re-keyed in the
same change, since a new key is otherwise indistinguishable from a new violation.

Those files MUST NOT enter any application build graph: the browser configuration and the spec tree
import test-only tooling that the application build has no reason to compile, and pulling them in
recreates exactly the Cluster-A failure mode this capability already forbids for test configuration.

#### Scenario: every end-to-end file has a typecheck baseline key [static]

- **Given** the rebuilt end-to-end tree
- **When** the tests-typecheck programme runs
- **Then** every end-to-end file is inside its scope with a baseline key, and the ratchet reports no new
  key for a pure rename

#### Scenario: no end-to-end file enters an application build graph [static]

- **Given** each portal's build tsconfig and the portal builds
- **When** the compiled file list is inspected
- **Then** no end-to-end spec, helper, fixture or browser configuration appears in it
- **And** the portal builds exit 0

---

## MODIFIED Requirements

### Requirement: `@shared/types` dist is built before every `next build` (the Turbopack boundary)

Turbopack cannot honor custom export conditions (vercel/next.js Discussion #78912, OPEN,
maintainer-confirmed) and cannot resolve `@shared/types`'s NodeNext `.js`-specifier'd source. Therefore
`@shared/types` MUST be consumed as **`dist`** by the Next apps (the deliberate Option-B
`@shared/types*`→`dist` tsconfig-paths mapping is preserved), and `@shared/types`'s `dist` MUST be
**built before** any `next build` runs. This guarantee MUST hold for **every** `next build`
invocation: the `size-limit (bundles)` CI job, the Dockerfile build stage, **and the new
"E2E (chromium)" job**, which builds both portals before starting the stack — a job that builds a
portal is a `next build` invocation and inherits this guarantee, whatever its purpose.
(Previously: the enumerated invocations were the size-limit job and the Dockerfile build stage only.)

#### Scenario: size-limit job builds @shared/types before the apps [empirical]

- **Given** the `size-limit (bundles)` job builds both portals
- **And** a portal's request configuration imports a `@shared/types` subpath
- **When** the job runs
- **Then** `@shared/types#build` runs first (via turbo `^build` expansion, a `@shared/types...` filter
  selector, or an explicit `@shared/types` prebuild step) so its `dist` exists
- **And** the subpath resolves to the built artifact
- **And** Turbopack reports **zero** `Module not found: Can't resolve '@shared/types/...'`

#### Scenario: Dockerfile build stage builds shared dist before next build

- **Given** the Dockerfile build stage runs `next build` for an app that imports `@shared/types/*`
- **When** the stage executes
- **Then** `@shared/types`'s `dist` is built before the `next build` step
- **And** the app's `@shared/types/*` imports resolve to `dist`

#### Scenario: the E2E (chromium) job builds shared dist before it builds the portals

- **Given** the end-to-end job, which builds both portals before starting the stack
- **When** it runs
- **Then** `@shared/types`'s `dist` is built before either `next build`
- **And** Turbopack reports **zero** `Module not found: Can't resolve '@shared/types/...'`
- **And** the job's failure, if any, is a test verdict — never a module-resolution error

#### Scenario: The main Build Check ordering is not regressed

- **Given** the main CI "Build Check" job already builds `@shared/types` dist via turbo `^build`
  (`pnpm build` = `turbo run build`, `dependsOn: ["^build"]`)
- **When** this change adds the same guarantee to the end-to-end job
- **Then** the existing `^build` ordering in "Build Check" and in the size-limit job is left intact
  (only the missing guarantee is added, the working ones are not changed)
