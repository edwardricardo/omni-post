# OmniPost Testing Infrastructure — Complete Reference

Last updated: 2026-03-25

---

## Overview

OmniPost uses a layered testing strategy covering unit tests, mutation testing, UI integration tests, and a nightly CI pipeline. This document describes what is tested, how, and what remains as planned future work.

---

## Testing Stack

| Layer             | Tool                           | Version  | Purpose                                  |
| ----------------- | ------------------------------ | -------- | ---------------------------------------- |
| Unit tests        | Vitest                         | 4.0.18   | Domain logic, use cases, adapters, hooks |
| Integration tests | node:test                      | Built-in | DB + Redis integration                   |
| Mutation testing  | Stryker Mutator                | 9.6.0    | Verify test quality                      |
| Mutation runner   | @stryker-mutator/vitest-runner | 9.6.0    | Connects Stryker to Vitest               |
| UI integration    | @testing-library/react         | 16.x     | React hooks and context                  |
| CI — PR pipeline  | GitHub Actions (ci.yml)        | —        | Unit tests on push/PR                    |
| CI — Nightly      | GitHub Actions (nightly.yml)   | —        | Full suite + mutation                    |

---

## Test Suite Overview

| App / Package                           | Test Files | Tests       | Status       |
| --------------------------------------- | ---------- | ----------- | ------------ |
| apps/api                                | 303        | 6,401       | All pass     |
| apps/admin                              | 20         | 136         | All pass     |
| apps/client                             | 15         | 353         | All pass     |
| apps/workers                            | 7          | 78          | All pass     |
| packages/providers (10 providers)       | 69         | ~600        | All pass     |
| packages/adapters (8 adapters)          | 43         | ~400        | All pass     |
| packages/core + api-common + monitoring | 4          | ~50         | All pass     |
| **Total**                               | **~511**   | **~7,742+** | **All pass** |

---

## Mutation Testing Coverage

### Overall

| Metric                             | Value                          |
| ---------------------------------- | ------------------------------ |
| Stryker configurations             | 61 total (26 micro + 35 other) |
| Total mutants monitored (apps/api) | 24,611                         |
| Covered mutation score (apps/api)  | 63.8%                          |
| NoCoverage mutants (apps/api)      | 48%                            |

### By Target (covered score)

| Target                     | Score  | Notes                     |
| -------------------------- | ------ | ------------------------- |
| packages/core              | 94.12% | Excellent                 |
| providers/telegram         | 83.54% |                           |
| providers/linkedin         | 77.45% |                           |
| apps/admin                 | 76.60% |                           |
| providers/tiktok           | 73.88% |                           |
| providers/pinterest        | 73.68% |                           |
| providers/instagram        | 71.29% |                           |
| providers/bluesky          | 70.09% |                           |
| providers/x                | 67.39% |                           |
| adapters/dead-letter-queue | 68.45% |                           |
| apps/workers               | 66.80% |                           |
| providers/snapchat         | 62.85% |                           |
| providers/facebook         | 60.61% |                           |
| adapters/db-prisma         | 58.54% |                           |
| adapters/cache-redis       | 58.37% |                           |
| apps/client                | 55.89% | hooks excluded from scope |
| packages/api-common        | 51.48% |                           |
| adapters/storage-s3        | 43.61% |                           |

### Targeted File Scores (Sessions B-F3)

| File                          | Score  | Session |
| ----------------------------- | ------ | ------- |
| ConfigureExternalNotification | 100%   | C       |
| subscriptionSchemas           | 93.88% | B       |
| SetFirstComment               | 92.86% | C       |
| GetUsage                      | 91.30% | C       |
| ApprovalStatus                | 90.57% | B       |
| RevenueCalculator             | 88.24% | B       |
| MarkMessageRead               | 84.62% | D       |
| DiffCalculator                | 80.92% | B       |
| UpsertBrandVoice              | 80.39% | C       |
| CostCalculator                | 71.93% | B       |

### Known Score Ceilings

| Target              | Ceiling | Root cause                                        |
| ------------------- | ------- | ------------------------------------------------- |
| storage-s3          | ~45%    | CircuitBreaker absorbs S3Client calls             |
| cache-redis         | ~60%    | CircuitBreaker + Fastify plugin scope             |
| api-common          | ~55%    | Zod schema string literals (type-safe at compile) |
| Provider apiClients | ~35%    | CircuitBreaker + real HTTP                        |
| apps/api NoCoverage | 48%     | 11,827 mutants with zero test coverage            |

---

## What Is Tested and How

### Domain Layer (apps/api/src/domain/)

- **PostAggregate**: 74 tests — full state machine (DRAFT → REVIEW → SCHEDULED → PUBLISHING → PUBLISHED/FAILED/CANCELLED), validation, media, events
- **SocialMessageAggregate**: 36 tests — creation, status transitions, assignment, archival
- **Campaign entity**: 18 tests — lifecycle, status transitions, events
- **Value Objects**: Content (45 tests), ApprovalStatus (30), ScheduledTime (38), PublishStatus
- **Testing pattern**: Direct instantiation, no infrastructure

### Application Layer (apps/api/src/application/)

- **Posts**: CreatePost, UpdatePost, SchedulePost, DeletePost, GetPost, ListPosts (40 tests)
- **Inbox**: IngestSocialMessage (34 tests), MarkMessageRead, AssignMessage
- **Reports**: CreateScheduledReport, GenerateReport (17 tests)
- **Other**: Usage, BrandVoice, AIImage, FirstComment, ExternalNotifications, UTM, Campaigns, Recurring
- **Testing pattern**: vi.fn() mock repos + EventDispatcher

### Provider Adapters (packages/providers/)

All 10 providers tested: X, Instagram, Facebook, YouTube, TikTok, LinkedIn, Pinterest, Snapchat, Telegram, Bluesky. Tests cover publish, analytics, error handling, media. apiClient files excluded from Stryker (integration scope).

### apps/client

- **Hook tests** (renderHook): useAutoSave (12), useProviders (10), authContext (8)
- **Stryker scope**: lib/providers/registry.ts, lib/utils/, lib/templates/
- **registry.ts optimalTimesCache**: Static config — ~200 survivors are equivalent mutants

---

## What Is NOT Tested (and Why)

### Category D — Exempt (~203 files)

Config, types, re-exports, DI setup, thin routes, Storybook, E2E fixtures.

### Category B — Integration (~349 files)

Prisma repos, OAuth services, webhook processors, analytics. Needs Docker Compose test env.

### Category C — E2E (~264 files)

React components (admin 166, client 79, packages/ui 19). Needs Playwright.

### Category E — Blocked (~10 files)

7 admin services + 3 packages with hardcoded Prisma/CircuitBreaker. Fix: inject via constructor (~2 days).

---

## Stryker Configuration Map

| Config Type                      | Count  | When to run         |
| -------------------------------- | ------ | ------------------- |
| Per-package (providers/adapters) | 16     | PR verification     |
| Per-app (admin/client/workers)   | 3      | PR verification     |
| Micro-batch (A1-H1)              | 26     | Targeted directory  |
| Batch (1-8)                      | 8      | Full baseline       |
| Targeted (feature-only)          | 5      | After writing tests |
| Root config                      | 1      | Base only           |
| Micro-batch runner script        | 1      | Orchestration       |
| Batch runner script              | 1      | Orchestration       |
| **Total**                        | **61** |                     |

**Running mutation tests:**

```bash
# Single package (fast — for PRs)
cd packages/providers/x && pnpm exec stryker run

# Specific files (fastest — after writing tests)
cd apps/api && pnpm exec stryker run --mutate "src/domain/aggregates/PostAggregate.ts"

# Full apps/api via Turborepo (slow — nightly)
pnpm turbo run mutation

# Individual micro-batch
cd apps/api && node stryker-micro-batches.mjs A2
```

---

## CI/CD Pipeline

### PR Pipeline (ci.yml)

- Runs on push/PR
- `pnpm turbo run test` (cached)
- Gate: all tests must pass
- No mutation testing (too slow for PR)

### Nightly Pipeline (nightly.yml — 3 AM UTC)

- Node.js 24, PostgreSQL 15, Redis 7
- `pnpm turbo run test --force` (no cache)
- `pnpm turbo run mutation --force` (incremental Stryker)
- Uploads mutation HTML reports as artifacts (30-day retention)
- Creates GitHub issue on failure

---

## How to Add Tests for New Features

### New domain entity or use case

1. Test in `apps/api/tests/unit/domain/` or `tests/unit/application/`
2. Use vi.fn() mock repos
3. Cover: success, validation, business rules, errors
4. Verify: `pnpm exec stryker run --mutate "src/path/to/file.ts"`
5. Target: ≥75% domain, ≥65% application

### New provider

1. Test in `packages/providers/{name}/tests/`
2. Mock apiClient with vi.fn()
3. Cover: publish, analytics, errors, rate limits
4. Create integration stub: `tests/integration/apiClient.integration.test.ts`

### New React hook

1. Use `renderHook` from `@testing-library/react`
2. Test: initial, loading, success, error, empty states
3. Exclude from Stryker scope in `apps/client/stryker.config.mjs`

---

## Session History

| Session   | Tests      | Focus                                                          |
| --------- | ---------- | -------------------------------------------------------------- |
| Batch 2   | 456        | Bluesky, Snapchat, Client, Telegram, Workers                   |
| Batch 3   | 61         | cache-redis, storage-s3, api-common, LinkedIn, Pinterest       |
| A + A2    | 139        | LinkedIn mediaUpload, api-common, cache-redis fp(), storage-s3 |
| B         | 321        | apps/api billing, content, domain VOs, analytics               |
| C         | 76         | 8 zero-coverage use case directories                           |
| D         | 57         | Inbox, reports, Campaign entity                                |
| E         | 30         | apps/client hooks (useAutoSave, useProviders, authContext)     |
| F3        | 114        | PostAggregate (74), post use cases (40)                        |
| F5        | 12         | IngestSocialMessage conversation threading                     |
| **Total** | **~1,266** |                                                                |
