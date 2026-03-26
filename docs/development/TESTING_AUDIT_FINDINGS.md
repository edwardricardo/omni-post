# OmniPost Testing Coverage — Raw Audit Findings

Date: 2026-03-24

## File Counts

| Metric                                  | Count                              |
| --------------------------------------- | ---------------------------------- |
| Total TypeScript source files           | ~1,300 (excl. 13,188 .stryker-tmp) |
| Total test files                        | ~511 (excl. 6,639 .stryker-tmp)    |
| Source files with no test (approximate) | ~400 (~31%)                        |

## Source Files by App/Package

| Location                 | Source Files |
| ------------------------ | ------------ |
| apps/api/src             | 566          |
| apps/admin               | 237          |
| apps/client/lib          | 19           |
| apps/workers/src         | 7            |
| packages/providers (all) | 118          |
| packages/adapters (all)  | 60           |
| packages/core            | 3            |
| packages/api-common      | 3            |
| packages/monitoring      | 7            |
| packages/shared          | 13           |
| packages/ui              | 45           |
| packages/ports           | 5            |
| **Total**                | **~1,300**   |

## Test Files by App/Package

| Location                            | Test Files | Tests (pass) |
| ----------------------------------- | ---------- | ------------ |
| apps/api                            | 338        | 6,275        |
| apps/admin                          | 20         | 136          |
| apps/client                         | 15         | 353          |
| apps/workers                        | 7          | 78           |
| packages/adapters/cache-redis       | 33         | ~203         |
| packages/providers/tiktok           | 21         | ~150         |
| packages/providers/instagram        | 18         | ~120         |
| packages/providers/linkedin         | 8          | ~60          |
| packages/providers/x                | 5          | ~40          |
| packages/providers/youtube          | 5          | ~40          |
| packages/adapters/dead-letter-queue | 3          | ~30          |
| packages/providers/pinterest        | 3          | ~25          |
| packages/providers/snapchat         | 3          | ~25          |
| packages/providers/bluesky          | 2          | ~20          |
| packages/providers/facebook         | 2          | ~15          |
| packages/providers/telegram         | 2          | ~15          |
| packages/api-common                 | 2          | ~20          |
| packages/adapters/storage-s3        | 2          | ~47          |
| Other packages (8)                  | 8          | ~50          |
| **Total**                           | **~511**   | **~7,700+**  |

## Timed-Out Micro-Batches (Session B)

| Batch ID | Directories                                 | Status               |
| -------- | ------------------------------------------- | -------------------- |
| A2       | middleware, services, posts, projects       | timed out (1h limit) |
| A3       | monitoring, audit, trends, saga             | timed out            |
| A4       | database, lib, cqrs, providers              | timed out            |
| A5       | templates, video, ai, billing               | timed out            |
| A8       | external-notifications, first-comment, etc. | timed out            |
| C1       | auth                                        | timed out            |
| C3       | admin                                       | timed out            |
| D3       | analytics root                              | timed out            |
| F2       | domain/value-objects                        | timed out            |
| G1       | infrastructure                              | timed out            |
| H1       | content                                     | timed out            |

**11 of 26 micro-batches timed out** (1h execSync limit). These directories have baseline data from the incremental file but no complete per-file Stryker scores.

Incremental file: `apps/api/reports/stryker-incremental.json` (9.4 MB)
Overall: 24,611 mutants, 63.8% covered score, 33.17% total score.

## Integration Test .todo() Files

| File                                                                          | Todo Count                 |
| ----------------------------------------------------------------------------- | -------------------------- |
| apps/client/tests/integration/hooks.integration.test.ts                       | 27                         |
| packages/providers/linkedin/tests/integration/apiClient.integration.test.ts   | 13                         |
| packages/providers/telegram/tests/integration/apiClient.integration.test.ts   | 12                         |
| packages/providers/pinterest/tests/integration/apiClient.integration.test.ts  | 12                         |
| apps/workers/tests/integration/analyticsAggregationWorker.integration.test.ts | 12                         |
| packages/providers/snapchat/tests/integration/apiClient.integration.test.ts   | 10                         |
| apps/workers/tests/integration/reportGenerationWorker.integration.test.ts     | 10                         |
| apps/client/tests/integration/ConcurrentRenderer.integration.test.ts          | 7                          |
| **Total**                                                                     | **103 tests to implement** |

## Hooks Without Tests

All 5 hooks in apps/client/lib/hooks/ have coverage (unit or integration):

- useABTests.ts — integration test exists
- useAutoSave.ts — integration test exists (12 tests)
- useProviders.ts — unit + integration (10 tests)
- useTemplates.ts — integration test exists
- useTemplateVersions.ts — integration test exists

ConcurrentRenderer: test exists but 7 .todo() items (incomplete coverage)

## Nightly CI

| Workflow               | Schedule        | Stryker |
| ---------------------- | --------------- | ------- |
| nightly.yml            | 3 AM UTC daily  | **No**  |
| security-testing.yml   | 2 AM UTC daily  | No      |
| cleanup.yml            | 2 AM UTC Sunday | No      |
| dependency-updates.yml | 6 AM UTC daily  | No      |
| ci.yml                 | push/PR only    | No      |
| performance.yml        | event-driven    | No      |
| production-ci.yml      | event-driven    | No      |

**Status: Zero scheduled Stryker runs in CI. Mutation testing is manual-only.**

## Opossum / Circuit Breaker Usage

**Files using opossum (non-test): 0 found in grep search.**

Note: Circuit breaker implementations exist in `packages/monitoring/circuit-breaker/` and are used by provider apiClient files, but the pattern uses custom CircuitBreaker class, not the opossum npm package directly.

## optimalTimesCache

**Location:** `apps/client/lib/providers/registry.ts`

**What it is:** Static Map of optimal posting times per provider per day of week. Contains hardcoded time strings like `"09:00"`, `"12:00"`, `"15:00"` for each of 6 providers × 7 days.

**Consumed by:**

1. `registry.ts` — `getOptimalTimes()` method (line 363)
2. `useProviders.ts` — delegating to registry (line 78)
3. `SchedulePicker.tsx` — rendering optimal time suggestions in UI (lines 49-311)
4. `test-data.ts` — E2E fixture data

**Assessment:** Pure static configuration data feeding UI time recommendations. ~200 surviving Stryker mutants are string literal mutations (e.g., `"09:00"` → `""`) — these are equivalent mutants, not testable logic.

## Full Test Suite Status

| App/Package  | Test Files | Pass       | Fail  | Todo    | Status |
| ------------ | ---------- | ---------- | ----- | ------- | ------ |
| apps/api     | 338        | 6,275      | 0     | 5 skip  | ✅     |
| apps/admin   | 20         | 136        | 0     | 0       | ✅     |
| apps/client  | 15         | 353        | 0     | 28 todo | ✅     |
| apps/workers | 7          | 78         | 0     | 20 todo | ✅     |
| packages/\*  | 131        | ~900       | 0     | 0       | ✅     |
| **Total**    | **~511**   | **~7,742** | **0** | **53**  | **✅** |

## Stryker Config Inventory

| Category                    | Count  | Files                                                         |
| --------------------------- | ------ | ------------------------------------------------------------- |
| Main config (root)          | 1      | stryker.config.mjs                                            |
| Batch configs (1-8)         | 9      | stryker-batch-{1-8}.config.mjs + batch.mjs                    |
| Micro-batch configs (A1-H1) | 27     | stryker-micro-{A1-H1}.config.mjs + batches.mjs                |
| Targeted configs            | 5      | billing-only, content-only, domain-targeted, inbox, session-c |
| Per-package configs         | 16     | One per provider/adapter package                              |
| Per-app configs             | 3      | admin, client, workers                                        |
| **Total**                   | **61** |                                                               |

## Sessions A-E Summary

| Session   | Tests Written | Focus                                                                  |
| --------- | ------------- | ---------------------------------------------------------------------- |
| A + A2    | 139           | LinkedIn mediaUpload, api-common, cache-redis fp(), storage-s3         |
| B         | 321           | apps/api billing, content, domain VOs, analytics ROI                   |
| C         | 76            | 8 zero-coverage use case directories                                   |
| D         | 57            | Inbox (22), reports (17), Campaign entity (18)                         |
| E         | 30            | apps/client hooks integration (useAutoSave, useProviders, authContext) |
| **Total** | **623**       |                                                                        |
