# Session F5 — Break Thresholds + IngestSocialMessage + Nightly CI

Date: 2026-03-25

## Status: COMPLETE (Task 1 re-runs in background)

## Task 1 — Break Threshold Fixes

Fixed D3 glob pattern bug (include + exclude same pattern). Set `break: null` already present in all 6 configs. Re-running 6 batches in background to capture actual scores.

| Batch | Fix Applied                                                    | Status     |
| ----- | -------------------------------------------------------------- | ---------- |
| D3    | Fixed glob: `!src/analytics/*.ts` → `!src/analytics/*.test.ts` | Re-running |
| A8    | break: null already set                                        | Re-running |
| F2    | break: null already set                                        | Re-running |
| A3    | break: null already set                                        | Re-running |
| A5    | break: null already set                                        | Re-running |
| G1    | break: null already set                                        | Re-running |

## Task 2 — IngestSocialMessage

Added 12 tests covering:

- Conversation threading (increment count, set conversationId, handle findOrCreate failure)
- Provider/parentId parameter passing
- Message type variations (COMMENT, MENTION, DIRECT_MESSAGE, REPLY)
- Provider variations (INSTAGRAM, FACEBOOK)
- Event dispatch verification

| Metric    | Before | After |
| --------- | ------ | ----- |
| Tests     | 22     | 34    |
| New tests | —      | 12    |

## Task 3 — Nightly CI

| Check                                                  | Status               |
| ------------------------------------------------------ | -------------------- |
| Node.js version pinned to 22                           | ✅                   |
| Stryker step added (`pnpm turbo run mutation --force`) | ✅                   |
| Mutation artifact upload (30 day retention)            | ✅                   |
| turbo.json mutation task                               | ✅ (already existed) |
| YAML valid                                             | ✅                   |
| `continue-on-error: true` on Stryker step              | ✅                   |

## All tests still passing

| App      | Tests | Status |
| -------- | ----- | ------ |
| apps/api | 6,401 | ✅     |

## Files Modified

- `apps/api/stryker-micro-D3.config.mjs` — fixed glob pattern
- `apps/api/tests/unit/application/inboxUseCases.test.ts` — 12 new tests
- `.github/workflows/nightly.yml` — Node 22, Stryker step, artifact upload
