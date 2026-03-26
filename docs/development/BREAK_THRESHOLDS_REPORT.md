# Stryker Break Thresholds — Configuration Report

Date: 2026-03-17

## Summary

| Metric                       | Value    |
| ---------------------------- | -------- |
| Configs updated              | 34 of 34 |
| Configs skipped              | 0        |
| Dry-run verifications passed | 5        |
| Dry-run verifications failed | 0        |

## Formula

```
break = floor(covered_score) - 5
```

Minimum: 0 (when score < 5%).

## Break Values Applied

| Config                                          | Covered Score | Break Set | Change     |
| ----------------------------------------------- | ------------- | --------- | ---------- |
| stryker.config.mjs (root)                       | 57.70%        | 52        | null -> 52 |
| apps/api/stryker.config.mjs                     | 57.70%        | 52        | null -> 52 |
| apps/api/stryker-batch-1.config.mjs             | 62.85%        | 57        | null -> 57 |
| apps/api/stryker-batch-2.config.mjs             | ~61%          | 56        | null -> 56 |
| apps/api/stryker-batch-3.config.mjs             | 50.53%        | 45        | null -> 45 |
| apps/api/stryker-batch-4.config.mjs             | 55.06%        | 50        | null -> 50 |
| apps/api/stryker-batch-5.config.mjs             | 56.68%        | 51        | null -> 51 |
| apps/api/stryker-batch-6.config.mjs             | 56.60%        | 51        | null -> 51 |
| apps/api/stryker-batch-7.config.mjs             | 56.22%        | 51        | null -> 51 |
| apps/api/stryker-batch-8.config.mjs             | 57.70%        | 52        | null -> 52 |
| apps/workers/stryker.config.mjs                 | 29.45%        | 24        | null -> 24 |
| apps/admin/stryker.config.mjs                   | 76.60%        | 71        | null -> 71 |
| apps/client/stryker.config.mjs                  | 25.69%        | 20        | null -> 20 |
| adapters/cache-redis/stryker.config.mjs         | 31.89%        | 26        | null -> 26 |
| adapters/db-prisma/stryker.config.mjs           | 58.54%        | 53        | null -> 53 |
| adapters/dead-letter-queue/stryker.config.mjs   | 21.36%        | 16        | null -> 16 |
| adapters/external-apis/stryker.config.mjs       | 53.64%        | 48        | null -> 48 |
| adapters/fallback-strategies/stryker.config.mjs | 63.16%        | 58        | null -> 58 |
| adapters/queue-bullmq/stryker.config.mjs        | 53.01%        | 48        | null -> 48 |
| adapters/storage-cloudinary/stryker.config.mjs  | 41.48%        | 36        | null -> 36 |
| adapters/storage-s3/stryker.config.mjs          | 35.34%        | 30        | null -> 30 |
| providers/youtube/stryker.config.mjs            | 99.97%        | 60        | null -> 60 |
| providers/instagram/stryker.config.mjs          | 71.29%        | 66        | null -> 66 |
| providers/facebook/stryker.config.mjs           | 60.61%        | 55        | null -> 55 |
| providers/pinterest/stryker.config.mjs          | 53.06%        | 48        | null -> 48 |
| providers/linkedin/stryker.config.mjs           | 44.24%        | 39        | null -> 39 |
| providers/x/stryker.config.mjs                  | 67.39%        | 62        | null -> 62 |
| providers/telegram/stryker.config.mjs           | 28.04%        | 23        | null -> 23 |
| providers/snapchat/stryker.config.mjs           | 18.48%        | 13        | null -> 13 |
| providers/bluesky/stryker.config.mjs            | 17.95%        | 12        | null -> 12 |
| providers/tiktok/stryker.config.mjs             | 3.93%         | 0         | null -> 0  |
| core/stryker.config.mjs                         | 94.12%        | 89        | null -> 89 |
| api-common/stryker.config.mjs                   | 37.68%        | 32        | null -> 32 |
| monitoring/circuit-breaker/stryker.config.mjs   | 63.83%        | 58        | null -> 58 |

## Special Cases

| Config            | Reason                                              | Value Set |
| ----------------- | --------------------------------------------------- | --------- |
| providers/youtube | Timeout-driven score (99.97%) — unreliable baseline | 60        |
| providers/tiktok  | Score below 5% — floor(3)-5 is negative             | 0         |

## Dry Run Results

| Config                     | Result                 |
| -------------------------- | ---------------------- |
| apps/workers               | PASSED (78 tests, 1s)  |
| adapters/cache-redis       | PASSED (160 tests, 4s) |
| providers/x                | PASSED (78 tests, 12s) |
| core                       | PASSED (17 tests, 1s)  |
| monitoring/circuit-breaker | PASSED (14 tests, 1s)  |

## What This Protects Against

Now that break thresholds are set, any PR that causes the mutation score
to drop below the break value will fail CI. This prevents:

- New code being added without tests
- Existing tests being deleted without replacement
- Refactors that accidentally remove test coverage

## Next Step

The break thresholds are now anchored at current baselines. The next task
is to actively improve the lowest-scoring targets:

- providers/tiktok: 3.93% (break: 0) -> target 60%
- providers/bluesky: 17.95% (break: 12) -> target 50%
- providers/snapchat: 18.48% (break: 13) -> target 50%
- adapters/dead-letter-queue: 21.36% (break: 16) -> target 65%
- apps/client: 25.69% (break: 20) -> target 50%
