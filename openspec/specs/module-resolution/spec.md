# Module Resolution — Specification

> Living specification for the **module-resolution** capability: workspace module
> resolution across dev/test/CI and production. Source of truth: the empirically-verified
> RCA (dist deliberately removed to force the failure mode; fix applied; consumers
> re-resolved with `dist` absent).
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each requirement
> carries Given/When/Then acceptance scenarios. Scenarios marked **[empirical]** were
> reproduced in the RCA and are the literal pass/fail bar.

---

## Requirements

### Requirement: Node-family source consumers resolve workspace packages from `src` against an unbuilt tree

A Node-family **source** consumer — `tsx <file>`, `node --import tsx <file>`, or
`node --import tsx --test <file>` — that resolves a transpile-only workspace package by
its **bare specifier** (e.g. `@observability/logger`, `@infra/prisma`) against a tree
where the package's `dist` is **absent**, MUST resolve to the package's **`src`**, not
its `dist`. Resolution MUST succeed with **zero** `ERR_MODULE_NOT_FOUND` /
`Cannot find module` errors attributable to a missing `dist` artifact.

This applies to the consumers the production decision (ADR-0017's unconditional
`exports`→`dist`) regressed: the Prisma seed and the security `node:test` suites.

#### Scenario: Prisma seed resolves @observability/logger from src with dist absent [empirical]

- **Given** every transpile-only workspace package's `dist` directory is absent (unbuilt tree)
- **And** the seed entry `infra/prisma/seed.ts` imports `@observability/logger` by bare specifier
- **When** the seed runs as the dev/test/CI source consumer (the `@infra/prisma` `seed` script, a `tsx`-based invocation)
- **Then** `@observability/logger` resolves to its `src` entry (the `.ts` source)
- **And** there is **zero** `ERR_MODULE_NOT_FOUND` / `Cannot find module` for `@observability/logger`
- **And** execution proceeds past module loading to runtime logic (reaching `prisma.account.upsert`; a `P1001` database-not-reachable stop is acceptable — DB-down is the expected stop point, module-resolution failure is not)

#### Scenario: Security node:test resolves @infra/prisma/extensions subpath from src with dist absent [empirical]

- **Given** `infra/prisma`'s `dist` directory is absent (unbuilt tree)
- **And** `apps/api/src/security/tenantContext.ts` imports `@infra/prisma/extensions/tenantGuard.js` (a written `.js` specifier over `.ts` source)
- **And** that module is loaded transitively by `tests/auth.test.ts`, `tests/rbac.test.ts`, and `tests/security.test.ts`
- **When** the security suite runs as the source consumer (`node --import tsx --test` via the `test:auth` / `test:rbac` / `test:security` scripts)
- **Then** `@infra/prisma/extensions/tenantGuard.js` resolves through the package's `extensions` subpath to the `.ts` source in `src`
- **And** the run reports **0 cancelled** tests (the RCA observed `tests 18 / cancelled 0`)
- **And** a grep for `MODULE_NOT_FOUND` / `Cannot find module` over the run output returns **0** (remaining failures, if any, are HTTP/localhost-server, never module loading)

---

### Requirement: Production resolution is unchanged — `default`→`dist`

With **no** `development` condition requested (i.e. **no** `--conditions development` on
the invocation — the runtime container contract), every transpile-only workspace package
MUST resolve through `default` to its **`dist`** artifact, exactly as before this change.
The production resolution path SHALL be byte-for-byte equivalent in behavior to the
pre-change `exports`→`dist` model.

#### Scenario: Plain node import resolves a package to dist [empirical]

- **Given** a transpile-only workspace package whose `dist` is built
- **And** the consumer is plain `node` (or any runner) that does **not** pass `--conditions development`
- **When** the package is imported by bare specifier
- **Then** it resolves through `default` to the package's `dist/*.js`
- **And** the four core Node conditions (`node`, `default`, `import`, `require`) apply exactly as before — none are removed or overridden

#### Scenario: The runtime container never opts into the development branch

- **Given** the production image runtime (which builds `dist` and never passes `--conditions development`)
- **When** any workspace package is resolved at runtime
- **Then** the `development` branch is never selected
- **And** resolution lands on `dist`, identical to the pre-change contract

---

### Requirement: The `development` condition is strictly additive and inert by default

Adding the `development`→`src` branch to a package's `exports` MUST NOT change any
existing resolution outcome for the `default`, `import`, `require`, or `node` conditions.
The `development` branch SHALL be **inert** unless `--conditions development` is explicitly
passed on the invocation. The branch MUST be ordered **before** `default` within each
`exports` condition map (Node key order is significant — most-specific first, `default`
always last).

#### Scenario: Default/import/require/node resolution is unaffected by adding the development branch

- **Given** a package whose `exports` gains a `development`→`src` branch ordered before `default`
- **When** the package is resolved without `--conditions development` under any of `default` / `import` / `require` / `node`
- **Then** the resolved target is identical to the resolved target before the branch was added (`dist`)
- **And** no consumer that previously resolved to `dist` now resolves to `src`

#### Scenario: The development branch precedes default in object order

- **Given** any modified `exports` condition map (root or subpath)
- **When** the map is read
- **Then** `development` appears **before** `default` in object key order
- **And** `default` is the **last** key in the map

---

### Requirement: The `development` condition covers root AND every subpath export

The `development`→`src` branch MUST be mirrored on **every** export entry of a package —
the root (`.`) and every subpath pattern the package publishes (`./*`, and for
`@infra/prisma` specifically `./extensions/*`) — not just the root. A subpath import in
dev (e.g. `@infra/prisma/extensions/...`) MUST resolve from `src`, mirroring how the
vitest alias factory had to special-case `@infra/prisma/extensions`.

#### Scenario: Subpath import resolves from src in dev [empirical]

- **Given** `@infra/prisma`'s `exports` carry a `development`→`src` branch on `.`, `./extensions/*`, and `./*`
- **And** `dist` is absent
- **When** a source consumer with `--conditions development` imports `@infra/prisma/extensions/tenantGuard.js`
- **Then** the `./extensions/*` subpath entry's `development` branch matches first
- **And** the specifier resolves to `src/extensions/tenantGuard.ts`

#### Scenario: Root and wildcard subpaths each carry the development branch

- **Given** a package that publishes `.` plus a `./*` (and optionally `./extensions/*`) export
- **When** the modified `exports` are inspected
- **Then** **each** of those entries carries a `development`→`src` mapping ordered before its `default`→`dist`
- **And** no published export entry is left without the `development` branch

---

### Requirement: Source-mode invocations opt in via `--conditions development` on the command

Every dev/test/CI **source** consumer that resolves an unbuilt workspace package by bare
specifier MUST opt into the `development` condition by passing `--conditions development`
**directly on the invocation** — NOT via `NODE_OPTIONS` (GitHub Actions restricts
`NODE_OPTIONS` from `GITHUB_ENV`) and NOT via tsconfig `customConditions` alone (`tsx` does
not auto-read tsconfig `customConditions`). The covered invocations are: the Prisma seed,
the `test:auth` / `test:rbac` / `test:security` `node:test` scripts, and the
`node --import tsx --test` invocations in `apps/api/scripts/run-tests.sh`.

#### Scenario: The seed invocation carries the flag

- **Given** the `@infra/prisma` seed script
- **When** it is invoked in dev/test/CI
- **Then** the command includes `--conditions development` (e.g. `tsx --conditions development infra/prisma/seed.ts` or the `node --conditions development --import tsx` equivalent)
- **And** the flag is on the command, not in `NODE_OPTIONS`

#### Scenario: The security node:test scripts carry the flag

- **Given** the `test:auth`, `test:rbac`, and `test:security` scripts (and the `run-tests.sh` integration invocations)
- **When** they invoke `node --import tsx --test`
- **Then** each invocation includes `--conditions development`
- **And** the flag is on the command, not in `NODE_OPTIONS`

#### Scenario: No source-mode runtime invocation relies on a global env for the condition

- **Given** the CI environment (GitHub Actions, which restricts `NODE_OPTIONS` from `GITHUB_ENV`)
- **When** a source consumer needs the `development` condition
- **Then** the condition is supplied per-invocation on the command line
- **And** correctness does not depend on `NODE_OPTIONS` being honored
