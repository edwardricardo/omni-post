# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Apply these rules to every file you create or modify. No exceptions.**

---

## Development Commands

### Core Commands

- `pnpm dev` - Start API and workers concurrently
- `pnpm dev:api` - Start API server only (port 3000)
- `pnpm dev:workers` - Start workers only
- `pnpm dev:admin` - Start admin interface only
- `pnpm build` - Build all packages
- `pnpm test` - Run API tests
- `pnpm lint` - Run ESLint with TypeScript support
- `pnpm lint:fix` - Auto-fix ESLint issues
- `pnpm format` - Format code with Prettier
- `pnpm format:check` - Check code formatting

### Database Commands

- `pnpm db:up` - Start PostgreSQL and Redis via Docker Compose
- `pnpm db:studio` - Open Prisma Studio
- `pnpm db:migrate` - Run Prisma migrations
- `pnpm db:seed` - Seed database with test data

> **MANDATORY:** When a task includes Prisma schema changes, **always** run `pnpm db:up` first to start PostgreSQL + Redis, then run the migration. Never skip a migration because "DB is not running" — start it.

### Test Commands (API)

- `pnpm --filter @apps/api test` - Run unit tests with Vitest
- `pnpm --filter @apps/api test:unit:watch` - Run unit tests in watch mode
- `pnpm --filter @apps/api test:unit:coverage` - Run unit tests with coverage report
- `pnpm --filter @apps/api test:all` - Run all tests (Vitest unit + node:test integration)
- `pnpm --filter @apps/api test:integration` - Run integration tests only (requires DB + Redis)

---

## Project Structure

```text
apps/
  api/        - Fastify REST API server
  workers/    - BullMQ background job processors
  admin/      - Admin dashboard (Next.js)
  client/     - Client dashboard (Next.js)
infra/
  prisma/     - Database schema, migrations, and client
packages/
  ports/      - Port interfaces (technology-free)
  shared/     - Shared types, events, CQRS, saga definitions
  providers/  - Social platform adapters (x, instagram, facebook, youtube, tiktok)
  adapters/   - Infrastructure adapters (cache-redis, db-prisma, queue-bullmq, storage-s3, etc.)
  ui/         - Shared React components
  api-common/ - Base route handler, CSV export
  monitoring/ - Circuit breaker, health checks
  observability/ - OpenTelemetry instrumentation
  api-errors/ - Canonical ApiError class, its parsing helpers and predicates (admin, client)
  core/       - Bounded contexts: the domain and the application
  eslint-plugin-errors/ - ESLint rules that keep error code, status and text in the registry
  eslint-plugin-testing/ - ESLint rules for test files, and the assertion classifier
  i18n/       - Frontend-only i18n surface
  query-client/ - Shared TanStack Query client factory
  test-contracts/ - Reach engine and scope contract of the test suites
  vitest-shared/ - Shared vitest config factory
```

### Technology Stack

- **Backend**: TypeScript, Fastify, Prisma ORM
- **Database**: PostgreSQL with Redis for queues/caching
- **Frontend**: Next.js, React, Tailwind CSS, Radix UI
- **Testing**: Vitest (API unit tests, frontend), node:test (API integration tests), Playwright (E2E)
- **Monitoring**: Prometheus metrics, Pino structured logging, OpenTelemetry
- **Storage**: S3-compatible storage for media files

### Workspace Configuration

- **pnpm workspaces** with TypeScript project references
- **ESLint v9 flat config** with TypeScript support, React plugins
- **Prettier** for code formatting
- **Husky + lint-staged** for pre-commit quality checks
- **GitHub Actions CI** for automated testing and quality gates
- Shared TypeScript configuration in `tsconfig.base.json`
- Path mapping: `@ports/core`, `@infra/prisma`, `@shared/types`, etc.

### Environment Setup

- Requires `.env` file (copy from `.env.example`)
- PostgreSQL and Redis via `docker-compose.yml`
- Database URL: `postgresql://postgres:password123@localhost:5432/omnipostdb`
- Redis URL: `redis://localhost:6379`

---

## Documentation Policy

**All project documentation lives under `/docs/`.** Never create `.md` files in `apps/`, `packages/`, `infra/`, or any other directory. The only exceptions are `CLAUDE.md` (root) and `.claude/` configuration files.

**Artifact language.** Every tracked artifact is written in English: code, comments, configuration, CI, documentation and plans. The exempt classes (product locale data, a document with an English twin, immutable or third-party content, detector vocabulary) are defined in [ADR-0040](docs/technical/ADR-0040-artifact-language-and-role-attribution.md); fitness #53 holds the remaining debt per file and its allowlist names every exempt file. Spanish product text outside the locale files is a defect to fix, never an exception. A chat session is not an artifact.

**Roles, never people.** An artifact names the role that decides, never the person who holds it. The Product Owner decides what the product does: priorities, the route, product and legal decisions. The Maintainer decides how it is built and delivered: architecture, merges, releases, and the grant authority of the hooks. [docs/GOVERNANCE.md](docs/GOVERNANCE.md) maps each role to its holder and is the one document that names the person; where a tool or a link needs an identity is listed in ADR-0040. A quote of a person is an English translation attributed to the role.

**Requests in feature documents.** This rule overrides two clauses of ODD: `L1` quoting the request verbatim in the user's language, and each `S#` quoting the user's exact strings. A feature document carries only an English translation of each request and of each later correction, and its `S#` quote that translation. The originals are kept verbatim in one Engram observation per feature, under topic `odd/<feature>/requests`, replaced whole on each update. The pull request that implements a request quotes in its body the translated `L#` it implements, and the Product Owner's approval of that pull request approves the translation. Product data, such as `es` locale text, is copied as is.

**Plan closure.** Every tracked plan or tracker (a document whose purpose is to schedule or track work: the Master Plan, a roadmap, a tracker) carries a fixed `## Closure` heading that names where its state, decisions, rules, lessons and pending items go when it closes; one that predates this rule gains the heading at its closure at the latest. When it closes, each of them moves to the home its `## Closure` names, the file leaves the tree, and every place that cites it gets a permalink of the form `https://github.com/edwardricardo/omni-post/blob/<sha>/<path>`, where `<sha>` is a commit that still holds the file. Only what survives is translated. One exception stands, by the Product Owner's decision of 2026-11-10 ([ADR-0044](docs/technical/ADR-0044-feature-ordered-plan.md)): `docs/product/MASTER_PLAN.md` stays in the tree as an archive that takes no new row, and a citation of one of its closed rows may point at it.

### `/docs/` Structure

[docs/README.md](docs/README.md) is the index of the documentation, by area: look there before a document is created.

**Cross-cutting work.** Work that belongs to no feature (CI and gates, dependencies, the test system, observability, architecture rules, documentation and its checks, the security slice) is tracked in [docs/product/plan/cross-cutting.md](docs/product/plan/cross-cutting.md), a part of the plan ([docs/product/PLAN.md](docs/product/PLAN.md)). Consult it before starting any non-feature work, to avoid duplicating an item it already holds; an item that closes records its pull request and merge commit there.

**Findings outside a task's scope.** A finding a task makes outside its scope — dead code, duplication, a cast, a dirty comment, an anti-pattern, a forgotten feature, a type smell, or anything whose state is uncertain — is attached to the plan in the same pull request, with a descriptive upper-case id, `path:line` evidence and the task that found it: to its feature, in [docs/product/plan/chain.md](docs/product/plan/chain.md) or [docs/product/plan/areas.md](docs/product/plan/areas.md); to [docs/product/plan/cross-cutting.md](docs/product/plan/cross-cutting.md) when it belongs to no feature; to [docs/product/plan/parking.md](docs/product/plan/parking.md) when it is an idea. Its viability is decided when that feature opens, not when it is found. It is mentioned to the Product Owner, and the task continues scoped. The Master Plan held these rows until 2026-11-10 and takes no new one ([ADR-0044](docs/technical/ADR-0044-feature-ordered-plan.md)); the SMELL, FN and DEF ids written across the tree resolve in its rows and its §7 closure ledger, and no SMELL-N row is appended anywhere.

**Plan tracking.** The chain table of [PLAN.md](docs/product/PLAN.md) holds each feature's state, `open`, `in progress` or `closed`, and the pull request that closed it. A feature's first pull request sets `in progress` and writes the cut the Product Owner confirmed into its record in [chain.md](docs/product/plan/chain.md). Its closing pull request sets the row's `State` and `Closed by` (its number), updates the record's `Today` line and marks each item it resolved `Closed by #<n>`; a decision closes one as `Closed by decision of the <role> on <YYYY-MM-DD>: <decision>`. The merge commit and the date are read from the pull request. A `closed` feature holds no open item (fitness #56).

**Support documentation flow.** A unit that touches a path listed in the `paths` of a document under `docs/support/` updates that document in the same pull request (the sections that changed, and its `verified` stamp), or says why not in `## Support impact`. `pnpm support:index` generates the index and the non-features list, and `pnpm check:support` holds them.

**Deployment documentation flow.** A unit that adds, changes or removes something an operator configures or verifies around a deployment (a variable or secret a workflow reads, an env-schema variable or a Dockerfile `ARG`, an external account, a post-deployment check) updates its row in `docs/deployment/DEPLOYMENT_CHECKLIST.md` in the same pull request, or says why not in `## Deployment impact`.

**Foundation practices flow.** A unit that adds an ADR, adds or changes a CI gate or fitness check, or demolishes and redoes code records the practice it teaches in `docs/development/FOUNDATION_PRACTICES.md` in the same pull request, in that document's four-field format, or says why not in `## Foundation practices`.

The pull request template says what each section takes; silence is not an answer.

---

## Canon Documents — Auto-Loaded Children

The full canon is split across 5 files. CLAUDE.md and ALL 4 children are auto-loaded at every session start via `@`-import (Claude Code memory system, verified per [Claude Code memory docs](https://code.claude.com/docs/en/memory) §"Import additional files"). Editing any of them takes effect the next session.

@docs/architecture/ARCHITECTURE_CANON.md
@docs/development/CODING_STANDARDS.md
@docs/security/SECURITY_CANON.md
@docs/observability/LOGGING_CANON.md

Quick map of what lives where:

| File                                                                               | Covers                             |
| ---------------------------------------------------------------------------------- | ---------------------------------- |
| [docs/architecture/ARCHITECTURE_CANON.md](docs/architecture/ARCHITECTURE_CANON.md) | Hexagonal/DDD/CQRS/UoW/Saga/DI     |
| [docs/development/CODING_STANDARDS.md](docs/development/CODING_STANDARDS.md)       | TypeScript, naming, JSDoc, testing |
| [docs/security/SECURITY_CANON.md](docs/security/SECURITY_CANON.md)                 | Secrets, env, multi-tenant guards  |
| [docs/observability/LOGGING_CANON.md](docs/observability/LOGGING_CANON.md)         | Logging, redaction, caching, tasks |

Fitness `#24` (below) enforces that each child exists + has `## How to extend` + `**Owner:**` — anti-deletion guardrail.

---

## Pragmatic Exceptions

A canon rule is skipped once, deliberately and audibly: **every canon violation carries a `// canon-exception: <scenario>:<ticket-or-branch>` comment in the same file.** The allowed scenarios are `migration`, `prototype`, `hotfix`, `spike`, `test-fixture`, `decorative-demolition` and generated code (a header comment); the tripwire hook refuses any other, and a new scenario needs an ADR. What each scenario allows to skip, its follow-up, the record template of a hot patch and the reviewer's protocol are in [docs/development/CANON_ENFORCEMENT.md](docs/development/CANON_ENFORCEMENT.md): read it before writing a marker.

### Forbidden — never use as escape hatch

- **Security canon** (`docs/security/SECURITY_CANON.md`): NO exception. Insecure secret fallbacks, missing tenant guards, raw SQL on tenant tables, env-var leakage. The escape hatch is "wait for security review", not "skip it".
- **Multi-tenant isolation** (§2.1 + `docs/security/MULTI_TENANT_GUARDS.md`): NO exception. Cross-tenant ops go through `withSystemContext()`, which IS the canon-sanctioned path.
- **DI composition root rule** (`docs/architecture/ARCHITECTURE_CANON.md §Dependency Injection`): NO exception. The discipline cost is non-negotiable per ADR-0007.
- **`@layer` standard values** (3 only): NO exception. Amendments require an ADR, not a marker.

---

## Mandatory Pre-Action Triggers (Tripwires)

> **Hard-blocking checkpoints — these are NOT advisory.** `.claude/hooks-py/pre_edit_tripwire_blocker.py` blocks an Edit or Write that matches a tripwire unless the assistant message before it carries a valid `canon-check:` line or a `sensitive-edit` token is active. The reason of each row and how to extend the list are in [docs/development/CANON_ENFORCEMENT.md](docs/development/CANON_ENFORCEMENT.md).

### Tripwires

| #   | Pattern                                                                                                                                                                                                                                                                                                        | Held by                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | Comments matching `// <word>` where `<word>` ∈ {`temporary`, `temporal`, `provisional`, `puente`, `bridge`, `phase-bridge`, `hack`, `kludge`, `workaround`, `patch`, `parche`, `atajo`, `stub`, `placeholder`, `FIXME`, `XXX`, `time-bomb`, `silencioso`, `truco`, `trampa`} (case-insensitive, word-boundary) | `pre_edit_tripwire_blocker.py` |
| 1b  | `// TODO §X.Y` markers (TODO followed by `§` and section ref)                                                                                                                                                                                                                                                  | `pre_edit_tripwire_blocker.py` |
| 2   | `// canon-exception:` without a scenario from the [Pragmatic Exceptions](#pragmatic-exceptions) allowed list following the colon                                                                                                                                                                               | `pre_edit_tripwire_blocker.py` |
| 3   | Import `from "@core/<a>/..."` inside a file under `packages/core/<b>/src/` where `<a> ≠ <b>` and `<a> ∉ {domain, embeddings, application/UseCase}`                                                                                                                                                             | `pre_edit_tripwire_blocker.py` |
| 4   | Mass `sed -i` against import paths in Bash (regex `sed.*-i.*from.*@core`)                                                                                                                                                                                                                                      | no hook yet: the rule holds    |
| 5   | Architectural pattern choice: `extends X`, `class Y implements Z` for new bounded-context-crossing types, `Shared Kernel` / `Anti-Corruption Layer` in JSDoc                                                                                                                                                   | no hook yet: the rule holds    |
| 6   | Plan/phase/sprint/timeline reference inside `//` or `*` comments — matches `Workstream:`, `Phase <letter><digit>`, `§<n>.<n>(.<a>)?`, `S<n>.<n>`, `Per §` / `Resolves §` / `Closes §`, `Sprint/Phase/Fase <digit>`, `Roadmap (item/fase/phase/§)`                                                              | `pre_edit_tripwire_blocker.py` |
| 7   | (Separate hook `pre_edit_planmode_guard.py`) Edit/Write on branch matching `workstream/*` without recent Plan Mode activity in the transcript (no `EnterPlanMode` / `ExitPlanMode` tool, no Read/Edit of `/root/.claude/plans/*.md`). Trivial edits (< 30 lines diff on existing file) auto-pass.              | `pre_edit_planmode_guard.py`   |

### Canon-check signature format

To bypass a tripwire, the assistant message preceding the Edit/Write **must** contain a line of this exact form:

```
canon-check: <canon-file>.md §<rule-id> — <decision> authorized because <canonical reason>
```

Example (valid):

```
canon-check: feedback/canon-research.md §no-time-bombs — bridge `// TODO §5.1.c` rejected; resolution via port.
```

### Bypass via authorization token

`omnipost-allow sensitive-edit` opens a 15-minute token for both surfaces, sensitive paths and tripwires; every override is logged to `.claude/heuristic-overrides.log` and needs an ADR within 5 days.

**Push grants.** A push needs a window the Maintainer issued with `omnipost-allow push`. Each window allows one publication, and a failed push consumes nothing; `omnipost-allow status` lists the pending windows. The mechanics (`--count`, `--ttl`, pruning, revoking, the log) are in [docs/GOVERNANCE.md](docs/GOVERNANCE.md) §The hooks' grant issuer.

**Only the Maintainer issues grants.** No session writes `.claude/.allowed/` (pre-edit blocks every Edit/Write under it, pre-bash every Bash write construct on it) or runs `omnipost-allow` with anything but `status` (pre-bash); no token unlocks either, the `sensitive-edit` token included. The Maintainer issues, extends and revokes grants from their own terminal ([docs/GOVERNANCE.md](docs/GOVERNANCE.md) §The hooks' grant issuer). Reading the store (`ls`, `cat`, `jq`) stays allowed.

---

## Automated Compliance Checks (CI Fitness Functions)

**Wired to CI.** Every check below runs automatically in `.github/workflows/fitness.yml` on every `push` and `pull_request` (#37, #47 and #54 run on `pull_request` only: the subject of each is the PR's delta against its base, which a push run does not have — their steps skip cleanly there). Threshold: **hard-zero** for every check — any new occurrence fails the workflow with an `::error` annotation. (**#30 ran as an interim ratchet until 2026-10-14**, at a baseline of 3 quarantined test suites; the reach engine now holds it at a hard zero, and its quarantine is a list of named files, each with a reason and an owner, rather than a count, and may only shrink against the base commit's. **#38 is hard-zero over the swept tree and carries ONE ratcheted sub-count** for `packages/adapters/db-prisma` — a live-wired package whose sweep needs its own tests (SMELL-87). **#45 and #46 are hard-zero on stale pages and unclassified rows and carry one ratcheted `pending` count per inventory**, the `pendingBaseline` of its classification file — each file under `docs/legal/classification/` for the legal inventories of #45, `docs/support/classification/non-features.json` for the support inventory of #46: rows that wait for a human classification, not code to fix. **#50 is hard-zero on a stale record and stale entries and carries one ratcheted `pending` count**, the `pendingBaseline` of `scripts/testing/dependency-decisions.json`: the direct dependencies under the floor of real sites that wait for the Maintainer's decision. **#53 is held per file**: every tracked file's Spanish lines and name mentions equal its entry in `scripts/testing/artifact-language-baseline.json` in both directions, so each entry may fall and must never rise, and the file is deleted once every count is zero. Every baseline may fall and must never rise.) There are **57 checks, numbered #1-#57**. Run them locally before commit for fast feedback (the CI is the safety net, not the only enforcement).

A check whose scope path does not exist is **worse than no check**: `grep -r` on an absent directory exits 2, prints nothing, and `| wc -l` renders that as `0` — a green annotation asserting an invariant nobody measured. #2, #3 and #4 spent the whole post-relocation period in exactly that state. The CI mirror therefore asserts every scope directory exists **before** running its grep, and fails loudly when one is missing rather than passing quietly.

Each check is one line below: its number, the name of its step in `fitness.yml`, and how it runs (`shell` is inline shell; anything else is its command). Its block (the threat it prevents, its scope and exclusions, its command, its fail-closed paths and its residual limits) is in [docs/development/FITNESS_FUNCTIONS.md](docs/development/FITNESS_FUNCTIONS.md), under the same number. That document is read as a file and is never loaded ([ADR-0045](docs/technical/ADR-0045-instruction-context-budget.md)): before changing a check, its workflow step or the script it runs, find its block with `rg -n '^# <number>\.' docs/development/FITNESS_FUNCTIONS.md`, read it, and change it in the same pull request. Fitness #44 holds this list, the blocks and the numbered workflow steps to one set.

- **#1** No Prisma singleton imports in routes — shell
- **#2** Domain + application core is framework-free — shell
- **#3** No `any` in the core or in apps/api infrastructure — shell
- **#4** No raw throws in the core (domain + application) — shell
- **#5** No @ts-ignore or @ts-nocheck in production source — shell
- **#6** CQRS handlers don't touch Prisma directly — shell
- **#7** No randomUUID/Math.random in dedupeKey — shell
- **#8** No sprint/phase references in source comments — shell
- **#9** Every file has @file header — shell
- **#10** Only valid @layer values (domain/application/infrastructure) — shell
- **#11** No raw setInterval in backend — shell
- **#12** Every component file carries @component tag — shell
- **#13** No direct pino imports in apps/api — shell
- **#14** No per-class `private *Cache = new Map` in apps/api/src — shell
- **#15** No insecure secret fallbacks (CWE-798) — shell
- **#16** No direct process.env.* in apps/api/src outside config/env.ts — shell
- **#17** No direct process.env.* in Next.js apps outside lib/env.ts — shell
- **#18** No direct argon2.hash/verify outside passwordHashing.ts — shell
- **#19** No process.env reads inside provider Adapter classes — shell
- **#20** No legacy BullMQ repeatable API — shell
- **#21** No Prisma singleton imports outside composition roots — shell
- **#22** No @layer application in apps/api/src (application code lives in @core/application) — shell
- **#23** No raw Prisma queries outside tenant guard + composition root — shell
- **#24** Canon child docs MUST exist + structured (anti-deletion) — shell
- **#25** Circuit-breaker fail-fast for writes (two-part hard-zero) — shell
- **#26** No .js-on-.ts relative imports in bundler-compiled frontend dirs — shell
- **#27** Dev/test source-resolution invariants (--conditions development + @shared/types build-first) — shell
- **#28** Fastify trustProxy comes ONLY from the derived policy — shell
- **#29** No raw client-IP header reads outside resolveClientIp — shell
- **#30** Every test file has exactly one collector run by a required check — `pnpm --filter @packages/test-contracts reach`
- **#31** No vacuous-pass escape hatch in a test entry point (two-part hard-zero) — shell
- **#32** No committed skipped or focused test — shell
- **#33** Every extended root tsconfig listed in turbo.json globalDependencies — shell
- **#34** Every ::error in a workflow step pairs with a real failure in the same step — shell
- **#35** outputs:[] build overrides bound to verdict-only build scripts — shell
- **#36** Every positive scope glob of every vitest config matches a tracked file — `pnpm --filter @packages/test-contracts scopes`
- **#37** Coverage threshold floors never descend vs the PR base (pull_request only) — `node scripts/testing/coverage-floor-gate.mjs`
- **#38** Soft-delete read coherence: no read of a swept soft-deletable model without its deletedAt filter — shell
- **#39** Every accountId-bearing model is tenant-guard-enrolled or in the documented denylist — shell
- **#40** One transaction seam (allowlist) + the scope it binds is derived — shell
- **#41** Single-use claim shape: a consumption marker in data names its credential in where — shell
- **#42** No install-lifecycle script in a workspace package (one named exception) — shell
- **#43** One route-test composition root: every harness composes through the seam — shell
- **#44** Fitness inventory is contiguous and its count is derived — `node scripts/testing/fitness-inventory-gate.mjs`
- **#45** Legal inventories are current and every row is classified — `pnpm check:legal`
- **#46** Support documents are current and every tree candidate is classified — `pnpm check:support`
- **#47** Every touched source file carries the canon's method-level JSDoc (pull_request only) — `pnpm check:jsdoc`
- **#48** Every patched dependency has its record, its patch file and its ADR — `pnpm check:patched-deps`
- **#49** Every test-block lint rule stays at error and no inline directive turns one off — shell
- **#50** The dependency-usage record is current and every name under the floor is decided or counted pending — `pnpm check:deps-ledger`
- **#51** Every portal's message catalogs are complete and valid ICU for every declared locale — `pnpm check:i18n`
- **#52** The committed test ledger is what the tree yields — `pnpm check:ledger`
- **#53** Every tracked artifact is in English and names roles, never a person — `node scripts/testing/artifact-language-gate.mjs`
- **#54** Every deleted or rewritten test block has a committed mutation-diff record (pull_request only) — `node scripts/testing/record-coverage-gate.mjs`
- **#55** The auto-loaded instruction files match their manifest and budget, and the hooks that enforce them are wired — `node scripts/testing/instruction-context-gate.mjs`
- **#56** No closed feature has an open item — `node scripts/testing/plan-closure-gate.mjs`
- **#57** The error registry is whole and the list of existing error sites only shrinks — `pnpm check:errors`

**Not a numbered check: the integration-tier RLS coverage gate.** Whether row security covers every guard-enrolled table is database state, which no grep reads, so the gate is an integration test: `describe("pg_catalog coverage gate")` of `apps/api/tests/integration/rls-tenant-isolation.integration.test.ts`, run by the CI job `Integration Tests`. It is named here so the gate inventory stays complete; its record is in the reference, under "Not a numbered check".

**Extending the suite.** Adding a new fitness check requires four coordinated steps, in order:

1. Add the regex to `docs/development/FITNESS_FUNCTIONS.md`, as a block under the next number, with a one-line description of the threat being prevented and a comment justifying any exclusions, and add the check's line to the list above and raise the count sentence.
2. Add the corresponding step in `.github/workflows/fitness.yml` mirroring the regex exactly (paste, don't paraphrase — drift between the doc and the workflow is the failure mode). A script-backed check (#30, #36, #37, #44 to #48, #50 to #57) is the same rule one level up: its step and its block call the same command, and the script, pinned by its own tests, is the rule's single source, so neither file restates it. A script-backed check also adds its script to the `paths:` of `.claude/rules/fitness-functions.md`.
3. Prove the red path — mandatory for every NEW or MODIFIED check or CI gate, fitness or otherwise: plant the violation, run the gate, and observe a REAL failure (non-zero exit / `core.setFailed`; an `::error` annotation alone leaves the job green and proves nothing), then restore the tree byte-exact (verify with `cmp` or a checksum) and re-confirm the count is 0. A gate whose red path was never demonstrated does not merge.
4. Verify `count = 0` on `main` before merging the wire. If the count is non-zero on existing code, document the baseline + ramp-down plan as an item of the plan's cross-cutting part (`docs/product/plan/cross-cutting.md`) rather than locking in non-zero noise.

The regex in the reference IS the regex in CI, and a script-backed check's command there IS its command in CI — keep them in sync.

---

## Problem-Solving Standards

**CRITICAL: NEVER bypass problems or create workarounds.** Always fix the root cause.

1. **Research First**: Understand root cause and official solution
2. **Implement Proper Solution**: Apply the correct, standards-compliant fix
3. **Avoid Workarounds**: Never create temporary patches
4. **Fix Problems Immediately**: When you detect a problem, fix it before proceeding

**3+ Consecutive Errors Rule**: When 3 or more consecutive errors are encountered:

1. STOP the current task immediately
2. Diagnose the root cause, by reading and measuring, before any further attempt
3. Write the plan that fixes it
4. Only then continue with the previous task

### Code Quality Gates

- ESLint: Must pass with zero errors, zero warnings
- Prettier: All files must be formatted
- TypeScript: Must compile with zero errors
- All CI fitness functions must pass
- **Fix ALL errors found** — both new and pre-existing. Never skip or defer an error because "it was already there". Every build/lint/test run must end at zero errors.

---

## Communication

Always communicate what you are doing or trying to do. This allows the user to decide properly if that is what they want.
