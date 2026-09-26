# OmniPost Testing Infrastructure — Complete Reference

> **HISTORICAL — do not read as current state (marked 2026-09-26).**
> This report dates from 2026-03-25. One of its claims is no longer true: the sections
> describing `apps/api/src/domain/` and `apps/api/src/application/` refer to directories
> that were relocated to `packages/core/`. Separately, every test and file count below is
> a 2026-03-25 measurement that was never re-taken — a provenance limit, not a falsehood.
> Read it as a record of what was believed at the time, not as a description of the
> repository.

Last updated: 2026-03-25

---

## Overview

OmniPost uses a layered testing strategy covering unit tests, integration tests, UI integration tests, and a nightly CI pipeline. This document describes what is tested, how, and what remains as planned future work.

---

## Testing Stack

| Layer             | Tool                         | Version  | Purpose                                  |
| ----------------- | ---------------------------- | -------- | ---------------------------------------- |
| Unit tests        | Vitest                       | 4.0.18   | Domain logic, use cases, adapters, hooks |
| Integration tests | node:test                    | Built-in | DB + Redis integration                   |
| UI integration    | @testing-library/react       | 16.x     | React hooks and context                  |
| CI — PR pipeline  | GitHub Actions (ci.yml)      | —        | Unit tests on push/PR                    |
| CI — Nightly      | GitHub Actions (nightly.yml) | —        | Full suite, uncached                     |

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

All 10 providers tested: X, Instagram, Facebook, YouTube, TikTok, LinkedIn, Pinterest, Snapchat, Telegram, Bluesky. Tests cover publish, analytics, error handling, media.

### apps/client

- **Hook tests** (renderHook): useAutoSave (12), useProviders (10), authContext (8)
- **Unit-test focus**: lib/providers/registry.ts, lib/utils/, lib/templates/
- **registry.ts optimalTimesCache**: static configuration data, not behaviour

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

### Score ceilings recorded 2026-03-25 — the metric is gone, the leads are not

This report recorded per-target ceilings for a quality score the repo no longer produces. Those percentages cannot be reproduced and are deliberately NOT restated in other units. The root causes recorded against three of the targets survive as leads, unverified at this date:

| Target      | Root cause recorded 2026-03-25                    |
| ----------- | ------------------------------------------------- |
| storage-s3  | CircuitBreaker absorbs S3Client calls             |
| cache-redis | CircuitBreaker + Fastify plugin scope             |
| api-common  | Zod schema string literals (type-safe at compile) |

The fourth target it recorded — **provider apiClients, root cause "CircuitBreaker + real HTTP"** — is contradicted by the tree and must NOT be read as a reason to skip unit tests. Re-measured 2026-09-26: **14 committed vitest unit suites construct provider apiClients directly**, all outside `tests/integration/`. Two families are regression anchors for closed defects: the **seven** `*ApiClient.writeFailFast.test.ts` (all added by commit `6d92e8bf`), which pin behaviourally the same invariant fitness #25 enforces statically — no write-path fallback, no synthetic receipt — and the **four** `*ApiClient.cacheIsolation.test.ts` (three added by `d183cdae`, the facebook one by `3fb15c76`), which hold the N-SEC-1 circuit-breaker cross-tenant disclosure fix. The "New provider" checklist below asks for an integration stub; that is a floor, not a ceiling, and the CircuitBreaker does not stand between a unit test and an apiClient.

The apps/api figure this section used to carry — a share of uncovered mutants — is left OUT rather than converted, because a mutant-coverage share and a line-coverage share are not the same measurement and swapping one for the other is the substitution this correction exists to remove. The live, reproducible substrate is the four ratcheted floors in `apps/api/vitest.config.ts`, gated by fitness #37 (measured 2026-09-26: lines 56.8, functions 57.3, branches 47.8, statements 56.2).

---

## CI/CD Pipeline

### PR Pipeline (ci.yml)

- Runs on push/PR
- `pnpm turbo run test` (cached)
- Gate: all tests must pass

### Nightly Pipeline (nightly.yml — 3 AM UTC)

- Node.js 24, PostgreSQL 15, Redis 7
- `pnpm turbo run test --force` (no cache)
- Creates GitHub issue on failure

---

## How to Add Tests for New Features

### New domain entity or use case

1. Test in `apps/api/tests/unit/domain/` or `tests/unit/application/`
2. Use vi.fn() mock repos
3. Cover: success, validation, business rules, errors
4. Verify: `pnpm --filter @apps/api test:unit:coverage`
5. Target: the per-layer coverage floors in `docs/development/CODING_STANDARDS.md` §Coverage Targets (Domain 90%, Application 85%)

### New provider

1. Test in `packages/providers/{name}/tests/`
2. Mock apiClient with vi.fn()
3. Cover: publish, analytics, errors, rate limits
4. Create integration stub: `tests/integration/apiClient.integration.test.ts`

### New React hook

1. Use `renderHook` from `@testing-library/react`
2. Test: initial, loading, success, error, empty states

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
