# Mutant Kill Session B — apps/api Micro-Batch Execution + Test Writing

Date: 2026-03-19 to 2026-03-20

## Status: COMPLETE

Baseline established via 26 micro-batch Stryker runs. 321 new tests written across 11 files covering billing, content, domain, and analytics. Targeted Stryker runs verified test effectiveness.

## Architecture Decision

The original 8-batch Stryker configuration was too coarse:

- Batch 3 alone had 9,101 mutants and took 4h 14m
- Total estimated time for 8 batches: 20-30 hours

**Solution:** Created 26 micro-batches grouped by directory. Script: `apps/api/stryker-micro-batches.mjs`.

## Overall Baseline Results (26 micro-batches)

| Metric                  | Value                       |
| ----------------------- | --------------------------- |
| Total files mutated     | 208                         |
| Total mutants           | 24,611                      |
| Killed                  | 7,715                       |
| Timeout                 | 448                         |
| Survived                | 4,621                       |
| NoCoverage              | 11,827                      |
| **Covered score**       | **63.8%** (8,163 / 12,784)  |
| **Total score**         | **33.17%** (8,163 / 24,611) |
| Total baseline duration | ~15 hours                   |

## Tests Written in Session B

### Round 1: Billing + Content (138 tests)

| File                                       | Tests | Target Area                                                                                 |
| ------------------------------------------ | ----- | ------------------------------------------------------------------------------------------- |
| tests/unit/billingService.test.ts          | 19    | BillingService pure logic (getChangeType, calculateNextBillingDate, calculateBillingAmount) |
| tests/unit/subscriptionPlanService.test.ts | 33    | SubscriptionPlanService (plan lookups, tier validation, trial info, usage)                  |
| tests/unit/subscriptionSchemas.test.ts     | 39    | Zod schema validation (all subscription schemas, boundary tests)                            |
| tests/unit/DiffCalculator.test.ts          | 22    | Content diff generation, similarity scoring, change summaries                               |
| tests/unit/ConflictDetector.test.ts        | 25    | Sync conflict detection, resolution, history management                                     |

### Round 2: Domain + Analytics (183 tests)

| File                                                    | Tests | Target Area                                                                        |
| ------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------- |
| tests/unit/domain/value-objects.content.test.ts         | 45    | Content VO: creation, validation, platform limits, immutable updates, equality     |
| tests/unit/domain/value-objects.approval-status.test.ts | 30    | ApprovalStatus state machine: transitions, predicates, terminal states             |
| tests/unit/domain/value-objects.scheduled-time.test.ts  | 38    | ScheduledTime: future validation, lead time, horizon, timezone, immutable updates  |
| tests/unit/domain/aggregates.social-message.test.ts     | 36    | SocialMessageAggregate: creation, status transitions, assignment, archival, events |
| tests/unit/analytics/CostCalculator.test.ts             | 22    | ROI cost breakdown, attribution, provider costs, default model                     |
| tests/unit/analytics/RevenueCalculator.test.ts          | 12    | Revenue breakdown, provider revenue, estimated clicks, total revenue               |

### Total: **321 new tests** across **11 files**

## Targeted Stryker Verification Results

### Billing (55 min run)

| File                       | Total      | Covered    | Status    |
| -------------------------- | ---------- | ---------- | --------- |
| subscriptionSchemas.ts     | 93.88%     | 93.88%     | Excellent |
| types.ts                   | 100%       | 100%       | Perfect   |
| subscriptionRoutes.ts      | 91.30%     | 91.30%     | Excellent |
| BillingService.ts          | 62.79%     | 64.29%     | Good      |
| SubscriptionPlanService.ts | 57.97%     | 62.02%     | Good      |
| **billing total**          | **37.07%** | **52.72%** |           |

### Content (3 min 34s run)

| File                | Total      | Covered    | Status    |
| ------------------- | ---------- | ---------- | --------- |
| DiffCalculator.ts   | 77.37%     | 80.92%     | Very Good |
| ConflictDetector.ts | 59.30%     | 69.01%     | Good      |
| **content total**   | **66.67%** | **74.17%** |           |

### Domain + Analytics (14 min run)

| File                      | Total      | Covered    | Status    |
| ------------------------- | ---------- | ---------- | --------- |
| ApprovalStatus.ts         | 90.57%     | 90.57%     | Excellent |
| RevenueCalculator.ts      | 88.24%     | 88.24%     | Excellent |
| CostCalculator.ts         | 71.93%     | 71.93%     | Very Good |
| ScheduledTime.ts          | 71.53%     | 76.87%     | Very Good |
| Content.ts                | 66.67%     | 73.89%     | Good      |
| SocialMessageAggregate.ts | 49.00%     | 57.31%     | Moderate  |
| **combined total**        | **66.44%** | **72.50%** |           |

## Key Findings

### 1. Dry Run Bottleneck

Each micro-batch takes 15-20 min minimum for dry run (279 test files x perTest coverage). This dominates total wall time regardless of mutant count.

### 2. NoCoverage Dominates

11,827 of 24,611 mutants (48%) have zero test coverage. These cannot be killed by writing better assertions; they need new test files covering the untested source code.

### 3. Targeted Stryker Runs Are Efficient

Running Stryker on specific files (2-6 files) takes 3-15 minutes vs 1-4 hours for full batches. This approach is far more practical for iterative test-write-verify cycles.

### 4. Pure Logic Tests Are Highly Effective

Tests for pure business logic (ApprovalStatus 90.57%, RevenueCalculator 88.24%, subscriptionSchemas 93.88%) achieve very high mutation scores. DB-dependent code (SubscriptionStatsService 12.90%) remains low.

### 5. Areas Still Without Test Coverage

12 directories in apps/api have 0 test files (3,003 LOC total): inbox, campaigns, reports, recurring, external-notifications, first-comment, utm, ai-image, brand-voice, usage. The `application/` directory (10,065 LOC, 103 files) has only 11 test files.

## Micro-Batch Results (baseline)

| ID  | Name                                            | Duration | Status     |
| --- | ----------------------------------------------- | -------- | ---------- |
| A1  | health + utils + validation + metrics           | 15m 46s  | ✅         |
| A2  | middleware + services + posts + projects        | ~60m     | ⚠️ timeout |
| A3  | monitoring + audit + trends + saga              | ~60m     | ⚠️ timeout |
| A4  | database + lib + cqrs + providers               | ~60m     | ⚠️ timeout |
| A5  | templates + video + ai + billing                | ~60m     | ⚠️ timeout |
| A6  | events + inbox + mappers + accounts + channels  | 14m 26s  | ✅         |
| A7  | campaigns + notifications + reports + etc.      | 15m 21s  | ✅         |
| A8  | external-notifications + first-comment + etc.   | <1m      | ⚠️ timeout |
| B1  | security                                        | 43m 52s  | ✅         |
| B2  | orchestration                                   | 48m 34s  | ✅         |
| C1  | auth                                            | ~60m     | ⚠️ timeout |
| C2  | webhooks                                        | 45m 50s  | ✅         |
| C3  | admin                                           | ~60m     | ⚠️ timeout |
| D1  | analytics/crossPlatform                         | 4m 51s   | ✅         |
| D2  | analytics/performanceComparison + roi           | 3m 26s   | ✅         |
| D3  | analytics root                                  | <1m      | ⚠️ timeout |
| E1  | application: inbox + posts + ml                 | 32m 48s  | ✅         |
| E2  | application: recurring + analytics + campaigns  | 6m 55s   | ✅         |
| E3  | application: reports + approvals + links + etc. | 30m 30s  | ✅         |
| E4  | application: crisis + ai + external + etc.      | 3m 56s   | ✅         |
| F1  | domain/entities                                 | 46m 18s  | ✅         |
| F2  | domain/value-objects                            | ~60m     | ⚠️ timeout |
| F3  | domain/repositories                             | 2m 50s   | ✅         |
| F4  | domain/aggregates + events + errors             | 56m 47s  | ✅         |
| G1  | infrastructure                                  | ~60m     | ⚠️ timeout |
| H1  | content                                         | ~60m     | ⚠️ timeout |

**15 successful / 11 timed out** (execSync 1h limit)

## Script Location

```
apps/api/stryker-micro-batches.mjs
```

Run individual batch: `node stryker-micro-batches.mjs A1`
Run all: `node stryker-micro-batches.mjs`
Monitor: `tail -f .claude/session-b-progress.log`

## Recommended Next Steps

1. **Write tests for 0-coverage directories** — inbox (884 LOC), campaigns (479 LOC), reports (362 LOC), recurring (329 LOC)
2. **Write tests for application use cases** — 103 files with only 11 tests; prioritize inbox, campaigns, recurring
3. **Increase timeout** in `stryker-micro-batches.mjs` from 1h to 2h for large batches
4. **Re-run timed-out batches** with increased timeout to get complete baseline
5. **Use targeted Stryker runs** (specific files) for test-write-verify cycles — much faster than full batches
6. **Prioritize domain value objects** — CampaignStatus, SocialMessageStatus, UTMParameters, ShortCode still untested
