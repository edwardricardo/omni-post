# Session F4 — Timed-Out Micro-Batches Re-Run

Date: 2026-03-25

## Status: COMPLETE

All 11 timed-out batches re-run with increased timeout (1h → 2h). 5 completed successfully, 6 hit break threshold (score below configured minimum).

## Timeout Update

Old timeout: 3,600,000 ms (1 hour)
New timeout: 7,200,000 ms (2 hours)

## Batch Results

| Batch | Directories                                 | Status             | Killed | Survived | NoCov | Duration |
| ----- | ------------------------------------------- | ------------------ | ------ | -------- | ----- | -------- |
| D3    | analytics root                              | ⚠️ break threshold | -      | -        | -     | 2m       |
| A8    | external-notifications, first-comment, etc. | ⚠️ break threshold | -      | -        | -     | 2m       |
| F2    | domain/value-objects                        | ⚠️ break threshold | -      | -        | -     | 2h       |
| H1    | content                                     | ✅ completed       | 713    | 694      | 1,147 | 85m      |
| C1    | auth                                        | ✅ completed       | 2,369  | 1,575    | 2,397 | 101m     |
| C3    | admin                                       | ✅ completed       | 3,405  | 2,730    | 3,961 | 108m     |
| A2    | middleware, services, posts, projects       | ✅ completed       | 3,887  | 3,130    | 4,450 | 108m     |
| A3    | monitoring, audit, trends, saga             | ⚠️ break threshold | -      | -        | -     | 2h       |
| A4    | database, lib, cqrs, providers              | ✅ completed       | 5,470  | 4,465    | 5,596 | 111m     |
| A5    | templates, video, ai, billing               | ⚠️ break threshold | -      | -        | -     | 2h       |
| G1    | infrastructure                              | ⚠️ break threshold | -      | -        | -     | 2h       |

**Total runtime: ~16.5 hours**

## Covered Scores (from cumulative killed/survived)

Note: Numbers are cumulative from the incremental file, not per-batch isolated.

| Batch                  | Covered Score (killed/(killed+survived)) |
| ---------------------- | ---------------------------------------- |
| H1 (content)           | 713/(713+694) = **50.7%**                |
| C1 (auth)              | ~60.1% (cumulative delta)                |
| C3 (admin)             | ~55.5% (cumulative delta)                |
| A2 (middleware+posts)  | ~55.4% (cumulative delta)                |
| A4 (database+lib+cqrs) | ~55.1% (cumulative delta)                |

## Still Hitting Break Threshold (6 batches)

| Batch | Probable Cause                                                                        | Fix Needed                                                   |
| ----- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| D3    | analytics root files (engagementPredictor, realtimeAnalytics) — complex scoring logic | Lower break threshold or write targeted tests                |
| A8    | Tiny route files — mostly NoCoverage (route handlers without unit tests)              | Lower break threshold — these are Category D (exempt)        |
| F2    | domain/value-objects — 27 VOs, many with high survivor counts                         | Lower break threshold — Session B already tested the key VOs |
| A3    | monitoring+audit+trends+saga — infrastructure-heavy                                   | Lower break threshold — mostly Category B (integration)      |
| A5    | templates+video+ai+billing — mixed logic + infrastructure                             | Lower break threshold — billing tested in Session B          |
| G1    | infrastructure — all 76 files are Category B/E                                        | Lower break threshold or exclude from scope                  |

## Analysis

The "break threshold" failures are **not timeouts** — the batches completed their runs but scored below the configured `break` value in `stryker.config.mjs` (currently 52). The exit code 1 prevents the script from capturing the score.

**Recommendation:** For the 6 failing batches, either:

1. Set `break: null` in their micro-batch configs to capture scores without failing
2. Lower break thresholds to realistic values based on the code classification

## Total Session Duration

16 hours 39 minutes (19:14 → 11:53 next day)

## Next: Session F5

F5 covers:

1. Fix break thresholds for 6 failing micro-batches and re-run
2. IngestSocialMessage score improvement (47.73% → target 65%)
3. Nightly CI — add Stryker step consideration
