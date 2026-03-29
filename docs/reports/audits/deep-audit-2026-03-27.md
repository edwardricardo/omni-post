# OmniPost Deep Audit Report

Date: 2026-03-27
Post: All development phases (1-11) + All update sessions (U0-U6)

---

## Executive Summary

| Dimension        | Status | Critical Issues | Notes                                                      |
| ---------------- | ------ | --------------- | ---------------------------------------------------------- |
| Static Analysis  | ⚠️     | 0               | 451 `any` types, 3 console.\* in prod, 4 TODOs             |
| Mock Data        | ⚠️     | 1               | Mock trends in production service                          |
| Backend↔Frontend | ⚠️     | 1               | 17 routes without per-route auth; 29 pages no data fetch   |
| Architecture     | ⚠️     | 1               | Bluesky not registered in provider registry                |
| Database         | ✅     | 0               | 69 models, schema valid, no N+1 detected                   |
| Test Quality     | ⚠️     | 0               | 189 skip/todo, 5 skipped tests in main suite               |
| Security         | ❌     | 2               | 81 npm vulns (4 critical); 17 routes missing explicit auth |
| Performance      | ⚠️     | 0               | 0/45 routes with OpenAPI schema; 2 cache usage points      |
| Documentation    | ⚠️     | 0               | 0 routes with Fastify schema annotations                   |

**Overall product completion: ~82%**

---

## Phase 1 — Static Analysis

### Dead Code / `any` Types

- `any` type usages in production code: **451**
  - Concentrated in adapter interfaces, webhook types, AI types, sync engine types
  - apps/api/src/: ~215 | packages/\*/src/: ~240
- `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck` total: **192**
  - In production code: **0** ✅
  - In test files only: **192** (acceptable — testing protected members)

### Console Usage in Production

- Total: **9** instances
  - 6 in JSDoc examples (not real code) ✅
  - 3 real in `ResendEmailAdapter.ts` (lines 37, 71, 80) — should use LoggerPort

### TODO/FIXME/HACK/XXX Comments

- Total: **4**
  1. `apps/api/src/application/inbox/SyncProviderCommentsUseCase.ts:92` — TODO: Wire provider adapter integration
  2. `apps/api/src/inbox/inboxSyncJob.ts:66` — TODO: Implement channel listing
  3. `apps/api/src/infrastructure/adapters/GA4TrackingAdapter.ts:19` — false positive (JSDoc)
  4. `apps/client/app/dashboard/templates/TemplateManagementDashboard.tsx:172` — TODO: wire real template analytics

### Circular Dependencies

- Not run (madge requires full TS resolution; deferred to tooling session)

### Code Duplication

- Not run (jscpd deferred to tooling session)

---

## Phase 2 — Mock Data

| Check                              | Found                                                                        | Severity |
| ---------------------------------- | ---------------------------------------------------------------------------- | -------- |
| Mock keywords in production code   | 4 lines (trendAnalysisService.ts)                                            | MEDIUM   |
| Hardcoded test IDs in production   | 0 confirmed                                                                  | LOW      |
| Placeholder content                | 0                                                                            | NONE     |
| randomUUID as dedupeKey (saga bug) | **RESOLVED** — dedupeKey uses deterministic `publish-${postId}-${channelId}` | NONE     |

### Mock Data Details

- `apps/api/src/trends/trendAnalysisService.ts` lines 88, 199, 266, 327: Contains `mockTrends` and `mockPredictions` arrays — **hardcoded fake data returned by a production service**

---

## Phase 3 — Backend ↔ Frontend Connectivity

| Metric                      | Value                         |
| --------------------------- | ----------------------------- |
| Backend route files         | 45                            |
| Frontend admin pages        | 37                            |
| Frontend client pages       | 9                             |
| Admin API hooks             | 31 (27 in hooks/api/)         |
| Client API hooks            | 0 (uses server actions/proxy) |
| Pages with no data fetching | 29                            |

### Pages with No Data Fetching (29)

Many are legitimate wrapper pages that delegate to child components with hooks. Notable ones to verify:

- `apps/admin/app/(dashboard)/approvals/page.tsx`
- `apps/admin/app/(dashboard)/inbox/page.tsx`
- `apps/admin/app/(dashboard)/posts/new/page.tsx`
- `apps/admin/app/(dashboard)/scheduling/page.tsx`
- `apps/client/app/dashboard/templates/page.tsx`
- `apps/client/app/dashboard/posts/[id]/page.tsx`

### API Proxy

- Admin: `apps/admin/app/api/backend/[...path]/route.ts` — universal proxy with JWT injection ✅
- Client: `apps/client/app/api/backend/[...path]/route.ts` — same pattern ✅

---

## Phase 4 — Architecture Compliance

### Hexagonal Architecture

| Check                                             | Status | Violations                                        |
| ------------------------------------------------- | ------ | ------------------------------------------------- |
| Domain → Infrastructure (should be 0)             | ✅     | 0 (1 false positive: comment in ReadModelDtos.ts) |
| Domain → Application (should be 0)                | ✅     | 0 (1 false positive: JSDoc comment)               |
| Application → Infrastructure direct (should be 0) | ✅     | 0                                                 |

### DDD

| Check                             | Status                       |
| --------------------------------- | ---------------------------- |
| Domain entities                   | 13 (excl. base Entity)       |
| Domain aggregates                 | 4 (excl. base AggregateRoot) |
| Domain events properly dispatched | Yes — via outbox pattern     |

### CQRS

| Check                                  | Status                              |
| -------------------------------------- | ----------------------------------- |
| UseCase files (commands)               | 74                                  |
| Query files                            | 26                                  |
| Command/Query ratio                    | 2.8:1 (write-heavy, normal for CMS) |
| Commands returning data (violations)   | 0 ✅                                |
| Queries with side effects (violations) | 0 ✅                                |

### Saga + Outbox

| Check                                | Status                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| dedupeKey bug (randomUUID)           | **RESOLVED** — deterministic keys: `publish-${postId}-${channelId}`                       |
| Unit of Work called in use cases     | Yes — 2 use cases (CreatePost, UpdatePost) with optional UoW                              |
| UnitOfWork references in application | 8                                                                                         |
| Outbox references in codebase        | 88                                                                                        |
| Compensating transactions            | **REAL** — full implementation in SagaManagerExecution.ts with reverse-order compensation |

### DI Container

| Check                          | Status                     |
| ------------------------------ | -------------------------- |
| Use cases in application layer | 74                         |
| Use cases registered in DI     | **74** (all registered) ✅ |
| Queries registered             | 26+                        |
| Unregistered use cases         | **0**                      |

### CRITICAL: Bluesky Provider Not Registered

**File:** `apps/api/src/providers/providerRegistry.ts`

- Only 9 of 10 providers registered
- `blueskyAdapter` is NOT imported and NOT registered
- Bluesky package exists, has tests, has domain support — but cannot be used at runtime
- **Impact:** Bluesky channels cannot be created or published to

---

## Phase 5 — Database

| Check                        | Status                                                      |
| ---------------------------- | ----------------------------------------------------------- |
| Schema validation            | **Valid** ✅                                                |
| Prisma models                | 69                                                          |
| Domain entities              | 13                                                          |
| Domain aggregates            | 4                                                           |
| Models without domain entity | ~52 (projection/join/infra tables — normal for read models) |
| N+1 query patterns found     | 0 detected                                                  |
| findMany without pagination  | 0 (all use cursor/batch patterns)                           |

---

## Phase 6 — Test Quality

| Metric                              | Value |
| ----------------------------------- | ----- |
| Total test files                    | 466   |
| Total tests passing (API)           | 6,478 |
| Skipped tests (API)                 | 5     |
| Test files (API)                    | 305   |
| Skip/todo patterns across ALL tests | 189   |
| Test files with no assertions       | 0 ✅  |

### Skipped/Todo Breakdown

- Security tests (conditional DB skips): ~50+
- Client integration tests (describe.todo): ~30+
- Provider integration tests (conditional): ~20+
- API integration/smoke tests: ~40+
- Worker integration tests: ~10+

### Mutation Testing (Stryker Incremental)

- Files analyzed: 69
- Killed: 9
- Survived: 2 (test escapes — quality gap)
- NoCoverage: 48
- Timeout: 33
- RuntimeError: 1
- **Covered score: ~82%** (killed/covered)
- **Total score: ~45%** (killed/total — dragged down by NoCoverage)

### Stryker Configs

- API configs: 61 (stryker\*.mjs in apps/api/)
- Package configs: present in some packages

---

## Phase 7 — Security

| Check                          | Status                                                 |
| ------------------------------ | ------------------------------------------------------ |
| Routes without explicit auth   | 17 / 45                                                |
| Routes WITH explicit auth      | 28 / 45                                                |
| Password fields in responses   | 0 ✅                                                   |
| Server env vars in client code | 7 (all legitimate: NODE_ENV, API_URL) ✅               |
| Hardcoded secrets              | 0 ✅                                                   |
| npm vulnerabilities            | **81 total: 4 critical, 29 high, 38 moderate, 10 low** |

### Routes Without Explicit Auth (17)

Auth is applied per-route via `preHandler: [authenticateMiddleware]`, NOT globally. These routes have NO auth middleware:

| Route File                                           | Risk Level                             |
| ---------------------------------------------------- | -------------------------------------- |
| health/healthRoutes.ts                               | LOW (intentional — k8s probes)         |
| monitoring/cacheStatsRoutes.ts                       | HIGH — exposes cache internals         |
| usage/usageRoutes.ts                                 | HIGH — exposes usage data              |
| ai/routes.ts                                         | CRITICAL — AI generation without auth  |
| ai/promptTemplateRoutes.ts                           | HIGH — AI templates without auth       |
| content/contentRoutes.ts                             | CRITICAL — content access without auth |
| external-notifications/externalNotificationRoutes.ts | MEDIUM                                 |
| providers/providerRoutes.ts                          | HIGH — provider config without auth    |
| templates/templateRoutes.ts                          | HIGH — template data without auth      |
| projects/crisisRoutes.ts                             | HIGH — crisis management without auth  |
| projects/projectRoutes.ts                            | CRITICAL — project data without auth   |
| posts/optimizedPostsRoutes.ts                        | CRITICAL — post data without auth      |
| posts/postRoutes.ts                                  | CRITICAL — full post CRUD without auth |
| brand-voice/brandVoiceRoutes.ts                      | MEDIUM                                 |
| accounts/accountRoutes.ts                            | CRITICAL — account data without auth   |
| links/linkRoutes.ts                                  | MEDIUM                                 |
| trends/trendRoutes.ts                                | LOW — trend data                       |

**NOTE:** Some of these may apply auth at the individual endpoint level inside the route file (via inline preHandler), not at the plugin level. This requires manual verification of each file's internal structure. The check only detected whether the route FILE contains auth keywords, not whether every endpoint is protected.

### npm Vulnerabilities (81)

- 4 critical, 29 high, 38 moderate, 10 low
- Notable: Next.js CSRF bypass (low), and others in transitive deps

---

## Phase 8 — Performance

| Check                              | Status                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Routes with OpenAPI/Fastify schema | **0 / 45**                                                                                                    |
| Routes without schema              | 45 / 45                                                                                                       |
| Cache usage in application/infra   | 2 direct references                                                                                           |
| Cache infrastructure               | Complete (Redis, decorators, middleware, stats)                                                               |
| BullMQ queues                      | PUBLISH, REPORT_GENERATION, ANALYTICS_AGGREGATION, WEBHOOK_PROCESSING, WEBHOOK_DEAD_LETTER, DEAD_LETTER_QUEUE |
| Dead letter handling               | **159** references — comprehensive ✅                                                                         |
| Worker files                       | 7 (publish, analytics, report, metrics, telemetry)                                                            |

### Missing Fastify Schema Annotations

- **0 of 45 route files** use Fastify's native `schema:` option
- Routes use Zod for validation via ZodTypeProvider, but this means no auto-generated OpenAPI spec from route definitions
- The Scalar docs endpoint exists but may have incomplete schema coverage

---

## Phase 9 — Documentation

| Check                            | Status                                 |
| -------------------------------- | -------------------------------------- |
| API docs (/docs, /docs/json)     | ✅ Scalar + OpenAPI 3                  |
| Routes with OpenAPI schema       | 0 / 45                                 |
| CLAUDE.md                        | ✅ exists, comprehensive               |
| .env.example                     | ✅ exists, 51 variables                |
| Undocumented env vars            | 0 (all in .env.example)                |
| All 10 providers registered      | **NO — Bluesky missing from registry** |
| All 10 providers have UI preview | ✅ (5 custom + core system)            |
| All 10 providers have tests      | ✅ (49 test files total)               |

### Outdated Packages (13 devDependencies)

| Package                          | Current | Latest |
| -------------------------------- | ------- | ------ |
| eslint-plugin-react              | 7.37.2  | 7.37.5 |
| @typescript-eslint/eslint-plugin | 8.44.1  | 8.57.2 |
| @typescript-eslint/parser        | 8.44.1  | 8.57.2 |
| lint-staged                      | 16.2.0  | 16.4.0 |
| loadtest                         | 8.0.9   | 8.2.1  |
| prettier                         | 3.6.2   | 3.8.1  |
| tsx                              | 4.20.5  | 4.21.0 |
| @eslint/js                       | 9.36.0  | 10.0.1 |
| autocannon                       | 7.15.0  | 8.0.0  |
| eslint                           | 9.36.0  | 10.1.0 |
| eslint-plugin-react-hooks        | 5.1.0   | 7.0.1  |
| knip                             | 5.85.0  | 6.0.6  |
| @ast-grep/cli                    | 0.41.0  | 0.42.0 |

---

## Build & Lint Status

| Check            | Result                                |
| ---------------- | ------------------------------------- |
| TypeScript build | ✅ 0 errors, 9/9 tasks successful     |
| ESLint           | ✅ 0 errors, 0 warnings               |
| API unit tests   | ✅ 305 files, 6,478 passed, 5 skipped |
| Prisma schema    | ✅ Valid                              |

---

## Critical Issues (must fix before production)

| #   | Issue                                                                                                                         | Phase | Severity | Evidence                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ----- | -------- | ----------------------------------------------------------------- |
| 1   | 17 route files without explicit auth middleware — includes postRoutes, accountRoutes, projectRoutes, contentRoutes, AI routes | 7     | CRITICAL | `grep -L "authenticate\|preHandler\|onRequest"` on 45 route files |
| 2   | 81 npm vulnerabilities (4 critical, 29 high)                                                                                  | 7     | CRITICAL | `pnpm audit` output                                               |

## High Priority Issues (fix in next sprint)

| #   | Issue                                                                       | Phase | Severity | Evidence                                                                               |
| --- | --------------------------------------------------------------------------- | ----- | -------- | -------------------------------------------------------------------------------------- |
| 3   | Bluesky adapter not registered in providerRegistry.ts (only 9/10 providers) | 4     | HIGH     | `apps/api/src/providers/providerRegistry.ts` — no bluesky import                       |
| 4   | Mock data in trendAnalysisService.ts returned by production endpoints       | 2     | HIGH     | `apps/api/src/trends/trendAnalysisService.ts:88,266` — `mockTrends`, `mockPredictions` |
| 5   | 0/45 routes have Fastify schema annotations — OpenAPI spec incomplete       | 8     | HIGH     | `grep -L "schema:" route files`                                                        |
| 6   | 451 `any` type usages in production code                                    | 1     | HIGH     | `grep ": any\|as any\|<any>"` across apps/api/src + packages                           |
| 7   | 189 skip/todo test patterns across workspace                                | 6     | HIGH     | `grep "\.todo\|\.skip"` across test files                                              |
| 8   | ResendEmailAdapter uses console.\* instead of LoggerPort (3 instances)      | 1     | HIGH     | `apps/api/src/infrastructure/adapters/ResendEmailAdapter.ts:37,71,80`                  |

## Medium Priority Issues (plan for later)

| #   | Issue                                                                                         | Phase | Severity | Evidence                                         |
| --- | --------------------------------------------------------------------------------------------- | ----- | -------- | ------------------------------------------------ |
| 9   | Only 2 use cases use UnitOfWork (Create/UpdatePost) — other mutating use cases lack atomicity | 4     | MEDIUM   | `grep "unitOfWork" apps/api/src/application/`    |
| 10  | Only 2 direct cache usage points in application/infrastructure layers                         | 8     | MEDIUM   | `grep "cache\." in application + infrastructure` |
| 11  | Client app has 0 API hooks — data fetching pattern unclear                                    | 3     | MEDIUM   | No hooks/api/ directory in apps/client           |
| 12  | 3 TODOs in production code (inbox sync, channel listing, template analytics)                  | 1     | MEDIUM   | grep output                                      |
| 13  | Stryker mutation score: 48 NoCoverage mutants, 2 survived                                     | 6     | MEDIUM   | `apps/api/reports/stryker-incremental.json`      |
| 14  | 13 outdated devDependencies                                                                   | 9     | LOW      | `pnpm outdated`                                  |

---

## Confirmed Resolved (from previous audits)

| Issue                       | Was                     | Now                                                |
| --------------------------- | ----------------------- | -------------------------------------------------- |
| Saga dedupeKey randomUUID   | randomUUID in dedupeKey | Deterministic: `publish-${postId}-${channelId}` ✅ |
| TypeScript version scatter  | 3 versions              | 6.0.2 everywhere ✅                                |
| Node.js mismatch            | v20/22/24 mixed         | v24.14.1 everywhere ✅                             |
| ESLint warnings             | 371                     | 0 ✅                                               |
| Unpinned versions           | 45+                     | 0 ✅                                               |
| @ts-ignore in production    | Unknown                 | 0 ✅                                               |
| Domain layer isolation      | Unknown                 | Clean — 0 infra imports ✅                         |
| Application layer isolation | Unknown                 | Clean — 0 direct Prisma imports ✅                 |
| CQRS separation             | Unknown                 | Enforced — 0 violations ✅                         |
| Outbox pattern              | Incomplete              | 88 references, full implementation ✅              |
| Compensating transactions   | Stubs                   | Real implementation in SagaManagerExecution.ts ✅  |
| DI container coverage       | Gaps                    | All 74 use cases + 26 queries registered ✅        |

---

## Recommended Action Sessions

| Session | Title                                                      | Issues  | Priority |
| ------- | ---------------------------------------------------------- | ------- | -------- |
| A1      | Security hardening: auth middleware audit + npm vuln fixes | #1, #2  | P0       |
| A2      | Bluesky registration + mock data cleanup                   | #3, #4  | P0       |
| A3      | Route schema annotations (OpenAPI completeness)            | #5      | P1       |
| A4      | TypeScript strictness: reduce `any` types                  | #6      | P1       |
| A5      | Test backlog: resolve 189 skip/todo patterns               | #7      | P1       |
| A6      | UnitOfWork expansion + cache strategy                      | #9, #10 | P2       |
| A7      | DevDependency updates + tooling refresh                    | #14     | P2       |
