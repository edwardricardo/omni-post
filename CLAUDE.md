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

Before a schema change, and again after its migration, read [docs/architecture/schema-conventions.md](docs/architecture/schema-conventions.md): the schema conventions, and the Prisma client regenerated after every migration.

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

**Plan closure.** Every tracked plan or tracker (a document whose purpose is to schedule or track work: a roadmap, a tracker) carries a fixed `## Closure` heading that names where its state, decisions, rules, lessons and pending items go when it closes; one that predates this rule gains the heading at its closure at the latest. When it closes, each of them moves to the home its `## Closure` names, the file leaves the tree, and every place that cites it gets a permalink of the form `https://github.com/edwardricardo/omni-post/blob/<sha>/<path>`, where `<sha>` is a commit that still holds the file. Only what survives is translated. The planning documents the plan replaced are absorbed into it: nothing in the tree references them, and their files are kept in an archive folder that nothing names (the Product Owner's decision of 2026-11-25, [ADR-0044](docs/technical/ADR-0044-feature-ordered-plan.md) as amended on 2026-11-27).

### `/docs/` Structure

[docs/README.md](docs/README.md) is the index of the documentation, by area: look there before a document is created.

**Cross-cutting work.** Work that belongs to no feature (CI and gates, dependencies, the test system, observability, architecture rules, documentation and its checks, the security slice) is tracked in [docs/product/plan/cross-cutting.md](docs/product/plan/cross-cutting.md), a part of the plan ([docs/product/PLAN.md](docs/product/PLAN.md)). Consult it before starting any non-feature work, to avoid duplicating an item it already holds; an item that closes records its pull request and merge commit there.

**Findings outside a task's scope.** A finding a task makes outside its scope — dead code, duplication, a cast, a dirty comment, an anti-pattern, a forgotten feature, a type smell, or anything whose state is uncertain — is attached to the plan in the same pull request, with a descriptive upper-case id, `path:line` evidence and the task that found it: to its feature, in [docs/product/plan/chain.md](docs/product/plan/chain.md) or [docs/product/plan/areas.md](docs/product/plan/areas.md); to [docs/product/plan/cross-cutting.md](docs/product/plan/cross-cutting.md) when it belongs to no feature; to [docs/product/plan/parking.md](docs/product/plan/parking.md) when it is an idea. Its viability is decided when that feature opens, not when it is found. It is mentioned to the Product Owner, and the task continues scoped. The SMELL, FN and DEF ids written across the tree resolve in the plan (`pnpm plan:show <id>`), and no SMELL-N row is appended anywhere.

**Plan tracking.** The chain table of [PLAN.md](docs/product/PLAN.md) holds each feature's state, `open`, `in progress` or `closed`, and the pull request that closed it. A feature's first pull request sets `in progress` and writes the cut the Product Owner confirmed into its record in [chain.md](docs/product/plan/chain.md). Its closing pull request sets the row's `State` and `Closed by` (its number), updates the record's `Today` line and marks each item it resolved `Closed by #<n>`; a decision closes one as `Closed by decision of the <role> on <YYYY-MM-DD>: <decision>`. The merge commit and the date are read from the pull request. A `closed` feature holds no open item (fitness #56).

**Support documentation flow.** A unit that touches a path listed in the `paths` of a document under `docs/support/` updates that document in the same pull request (the sections that changed, and its `verified` stamp), or says why not in `## Support impact`. `pnpm support:index` generates the index and the non-features list, and `pnpm check:support` holds them.

**Deployment documentation flow.** A unit that adds, changes or removes something an operator configures or verifies around a deployment (a variable or secret a workflow reads, an env-schema variable or a Dockerfile `ARG`, an external account, a post-deployment check) updates its row in `docs/deployment/DEPLOYMENT_CHECKLIST.md` in the same pull request, or says why not in `## Deployment impact`.

**Foundation practices flow.** A unit that adds an ADR, adds or changes a CI gate or fitness check, or demolishes and redoes code records the practice it teaches in `docs/development/FOUNDATION_PRACTICES.md` in the same pull request, in that document's four-field format, or says why not in `## Foundation practices`.

The pull request template says what each section takes; silence is not an answer.

---

## Canon Documents — Auto-Loaded Children

The canon is this file and four children, which load with it at session start through the `@`-imports below ([Claude Code memory docs](https://code.claude.com/docs/en/memory) §"Import additional files"); an edit takes effect the next session. A child holds its rules: their rationale, more examples and `## How to extend` are in the companion `*_REFERENCE.md` beside it, and a rule that governs one area (sagas, React, the client portal, Prisma, dependencies) is in that area's document, named by a pointer line of the loaded canon. Companions and area documents are read as files, never imported.

@docs/architecture/ARCHITECTURE_CANON.md
@docs/development/CODING_STANDARDS.md
@docs/security/SECURITY_CANON.md
@docs/observability/LOGGING_CANON.md

| File                                                                               | Covers                                                                     |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [docs/architecture/ARCHITECTURE_CANON.md](docs/architecture/ARCHITECTURE_CANON.md) | Hexagonal/DDD/CQRS/UoW/Saga/DI                                             |
| [docs/development/CODING_STANDARDS.md](docs/development/CODING_STANDARDS.md)       | TypeScript, naming, JSDoc, testing                                         |
| [docs/security/SECURITY_CANON.md](docs/security/SECURITY_CANON.md)                 | Secrets, tenant isolation, client IP, literal parameters, dependency audit |
| [docs/observability/LOGGING_CANON.md](docs/observability/LOGGING_CANON.md)         | Logging, redaction, caching, tasks                                         |

Fitness `#24` is the anti-deletion guardrail: each child exists and carries `**Owner:**`, and its companion exists and carries `## How to extend`.

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

There are **58 checks, numbered #1-#58**, wired to `.github/workflows/fitness.yml` on every `push` and `pull_request` and held at hard zero; the checks that carry a ratcheted baseline, and the three that run on `pull_request` only, say so in their blocks. The inventory (each check's number, name and command) and each check's block are in [docs/development/FITNESS_FUNCTIONS.md](docs/development/FITNESS_FUNCTIONS.md), which is read as a file and never loaded ([ADR-0045](docs/technical/ADR-0045-instruction-context-budget.md)): before changing a check, its workflow step or the script it runs, find its block with `rg -n '^# <number>\.' docs/development/FITNESS_FUNCTIONS.md`, read it, and change it in the same pull request. Fitness #44 holds the inventory, the blocks and the numbered workflow steps to one set.

Every new or modified check or CI gate, fitness or otherwise, proves its red path before it merges: plant the violation, observe a real failure (a non-zero exit, never an `::error` annotation alone), restore the tree byte-exact and confirm the count is 0. The steps to add a check are in the reference, under "Extending the suite".

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
