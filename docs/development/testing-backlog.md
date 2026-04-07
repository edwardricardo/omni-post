# OmniPost Testing Backlog

Last updated: 2026-03-28 (A5 audit remediation)

This document tracks all testing work that is known, planned, or deferred.
Single source of truth for testing debt.

---

## P1 — High Impact, No Prerequisites

| Item                                               | Effort | Notes                                            |
| -------------------------------------------------- | ------ | ------------------------------------------------ |
| Implement 103 .todo() integration tests (8 files)  | L      | Needs provider credentials in CI env vars        |
| Write tests for remaining 85 Class A use cases     | L      | Posts done; inbox partial, campaigns, team, etc. |
| Playwright E2E suite — Social Inbox flow           | M      | Highest business value E2E                       |
| Playwright E2E suite — Approval Workflow flow      | M      | Backend complete                                 |
| ConcurrentRenderer tests (7 .todo() items)         | S      | jsdom or happy-dom                               |
| Domain value objects — 27 VOs need dedicated tests | M      | Content, ScheduledTime, ApprovalStatus done      |

## P2 — Requires Architectural Change

| Item                                                  | Effort | Impact                                               |
| ----------------------------------------------------- | ------ | ---------------------------------------------------- |
| Extract ICircuitBreaker interface in all adapters     | M      | Unlocks ~10 Category E files, +15-25% adapter scores |
| Inject Prisma in 7 admin service files                | S      | Unlocks 7 files from Category E → A                  |
| Docker Compose test environment for integration tests | M      | Unlocks ~349 Category B files                        |
| Install aws-sdk-client-mock for storage-s3            | S      | Push storage-s3 from 43% → 65%+                      |

## P2.5 — Frontend: Unimplemented Features (no backend endpoint)

| Item                       | App    | Notes                                                       |
| -------------------------- | ------ | ----------------------------------------------------------- |
| Trial Extend button        | admin  | No `POST /admin/billing/accounts/:id/trial/extend` endpoint |
| Compliance GDPR config     | admin  | No compliance configuration endpoint                        |
| Compliance Security config | admin  | No compliance configuration endpoint                        |
| Channel Test Connection    | client | No `/channels/:id/test` or health check endpoint            |
| Instagram Stories Save     | client | No dedicated stories save endpoint                          |
| Instagram Stories Schedule | client | No dedicated stories schedule endpoint                      |
| Instagram Stories Publish  | client | No dedicated stories publish endpoint                       |

## P3 — Deferred / Conditional

| Item                                 | Condition                             | Notes                            |
| ------------------------------------ | ------------------------------------- | -------------------------------- |
| Social Advertising tests             | When feature is built                 | TikTok Marketing API stub exists |
| Employee Advocacy tests              | When feature is built                 | —                                |
| Multi-level approval chain tests     | When feature is built                 | —                                |
| Bluesky E2E auth flow                | When AT Protocol OAuth is implemented | Currently App Passwords          |
| YouTube Community Posts tests        | When YouTube Partner Program access   | —                                |
| Playwright E2E — Notification Center | When SSE infrastructure ready         | S                                |

## Permanently Exempt

| Pattern                                          | Count    | Reason                   |
| ------------------------------------------------ | -------- | ------------------------ |
| TypeScript type definitions                      | ~40      | Compile-time only        |
| index.ts barrel re-exports                       | ~45      | No logic                 |
| DI container setup (apps/api)                    | 20       | Composition root         |
| Config files (vitest, stryker, playwright)       | ~12      | Configuration            |
| Storybook stories                                | ~15      | Documentation            |
| Radix UI primitive wrappers (packages/ui)        | 25       | Thin forwardRef wrappers |
| Next.js layout/error/loading pages               | ~12      | Framework pages          |
| E2E test infrastructure (page objects, fixtures) | ~12      | Test helpers             |
| **Total exempt**                                 | **~181** |                          |

---

## Skip/Todo Pattern Audit (A5 — 2026-03-28)

115 total patterns found. 37 CLASS D (conditional, correct). 73 CLASS C (pending features). 5 CLASS B (moved to integration).

- 4 providerRegistry DB tests → moved to `tests/integration/providerRegistry.db.test.ts`
- 1 SSE webhook test → removed skip, documented as architectural limitation

## Integration Test .todo() Files

8 files with test cases documented but not implemented:

| File                                                                          | Tests   | Infrastructure Needed      |
| ----------------------------------------------------------------------------- | ------- | -------------------------- |
| apps/client/tests/integration/hooks.integration.test.ts                       | 27      | jsdom + React Query        |
| providers/linkedin/tests/integration/apiClient.integration.test.ts            | 13      | OAuth access token         |
| providers/telegram/tests/integration/apiClient.integration.test.ts            | 12      | Bot token + test channel   |
| providers/pinterest/tests/integration/apiClient.integration.test.ts           | 12      | OAuth access token         |
| apps/workers/tests/integration/analyticsAggregationWorker.integration.test.ts | 12      | PostgreSQL + Redis         |
| providers/snapchat/tests/integration/apiClient.integration.test.ts            | 10      | OAuth credentials + org ID |
| apps/workers/tests/integration/reportGenerationWorker.integration.test.ts     | 10      | PostgreSQL + Redis         |
| apps/client/tests/integration/ConcurrentRenderer.integration.test.ts          | 7       | jsdom/happy-dom            |
| **Total**                                                                     | **103** |                            |

---

## Mutation Score Improvement Opportunities

| Target               | Current    | Potential      | What's Needed                                   |
| -------------------- | ---------- | -------------- | ----------------------------------------------- |
| apps/api NoCoverage  | 48% no-cov | Reduce to ~20% | Write tests for 85 Class A use cases            |
| storage-s3           | 43.61%     | 65%+           | ICircuitBreaker injection + aws-sdk-client-mock |
| cache-redis          | 58.37%     | 70%+           | More middleware integration tests               |
| api-common           | 51.48%     | 55% ceiling    | Zod schema literals (equivalent mutants)        |
| adapters (all)       | 35-60%     | 65-80%         | ICircuitBreaker interface extraction            |
| domain value objects | partial    | 80%+           | 27 VOs need dedicated test files                |
| IngestSocialMessage  | 47.73%     | 75%+           | More threading/idempotency edge cases           |

---

## File Classification Summary (from F2)

| Category                 | Count     | %    | Action                  |
| ------------------------ | --------- | ---- | ----------------------- |
| A — Unit testable now    | 233       | 22%  | Write tests (P1)        |
| B — Integration testable | 349       | 33%  | Docker Compose env (P2) |
| C — E2E only             | 264       | 25%  | Playwright (P1/P3)      |
| D — Exempt               | 203       | 19%  | No action               |
| E — Blocked              | 10        | 1%   | Refactor (P2)           |
| **Total untested**       | **1,059** | 100% |                         |
