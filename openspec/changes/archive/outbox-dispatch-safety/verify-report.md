# Verification Report — outbox-dispatch-safety

- **Change**: outbox-dispatch-safety (Variant B — reorder `processClaimed` to dispatch→markPublished, delete relay-side `OutboxInbox`)
- **Branch**: fix/outbox-dispatch-safety (uncommitted working tree)
- **Mode**: openspec (+ engram)
- **Verdict**: PASS WITH WARNINGS
- **Date**: 2026-07-17

## Completeness

| Artifact                            | State                            |
| ----------------------------------- | -------------------------------- |
| spec (6 requirements / 8 scenarios) | present                          |
| tasks (24 tasks)                    | all 24 checked, match code state |
| design (Variant B)                  | present, approved                |
| apply-progress (engram obs 357)     | present                          |

## Gate Evidence (re-run independently)

| Gate                             | Command                                    | Result                                                                      |
| -------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| Unit                             | `pnpm --filter @apps/api test`             | 504 files / 7998 tests PASS, 0 fail, 0 cancelled                            |
| Typecheck                        | `tsc -p tsconfig.json --noEmit` (6GB heap) | exit 0, 0 errors                                                            |
| Integration (10x)                | `OutboxRelay.integration.test.ts`          | 10/10 GREEN (at-least-once: dispatched>=100, distinct==100, unpublished==0) |
| Regression smoke                 | `bulkScheduleOutboxSmoke.test.ts`          | 3/3 PASS, 0 cancelled                                                       |
| Fitness #3 (no any)              | grep                                       | 0                                                                           |
| Fitness #4 (no throw domain/app) | grep                                       | 0                                                                           |
| Fitness #8 (no sprint/phase)     | grep                                       | 0                                                                           |
| Fitness #9 (@file header)        | grep                                       | 0                                                                           |
| Fitness #10 (@layer valid)       | grep                                       | 0                                                                           |
| Fitness #23 (no new raw SQL)     | grep                                       | 0 (OutboxClaimService unchanged; OutboxRelay has no raw query)              |

## Structural Verification

- `OutboxInbox.ts` and `OutboxInbox.test.ts` DELETED (confirmed via `git status`: `D`).
- 0 residual `OutboxInbox` / `outbox_inbox` / `consumerId` references in `apps/api/src` + `apps/api/tests`.
- `TOKENS.OutboxInbox` removed from `container/types.ts`; DI registration + injection removed from `setupCrisisUseCases.ts`.
- Remaining repo references are expected: openspec change docs, updated `SLO.md`, intentionally-kept `MULTI_TENANT_GUARDS.md` row (dead-model annotation, per task 6.2), immutable migration SQL, stale audit snapshots (`docs/audits/_raw/*`).
- Diff: 193 insertions / 250 deletions across 11 files — under the 400-line budget.
- No-false-publish invariant: `processClaimed` calls `dispatch(event)` THEN `markPublished(id)`; `markPublished` sets `publishedAt` only after dispatch resolves. The inbox short-circuit path (the fixed bug) is fully removed.

## Spec Compliance Matrix

| Req                              | Scenario                                                 | Evidence                                                                                            | Status                                        |
| -------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| R1 No false publish [MB]         | transient error before dispatch (unit)                   | ordering test (invocationCallOrder) + dispatch-rejects→no markPublished                             | PASS                                          |
| R1 No false publish [MB]         | orphaned inbox row re-processed (integration)            | inbox removed — no code reads `outbox_inbox`; short-circuit impossible by construction; drain 10/10 | PASS (by removal)                             |
| R2 At-least-once [MB]            | crash between dispatch & terminal commit (unit)          | markPublished-rejects→releaseForRetry (redelivery, never loss)                                      | PASS                                          |
| R3 Exactly-once fault-free       | happy-path no duplicates (integration)                   | distinct==100, unpublished==0 (asserted as >=N + distinct==N, not strict ==N)                       | PASS                                          |
| R3 Exactly-once fault-free       | lease expiry during slow dispatch (integration)          | lease + SKIP LOCKED exercised by 2-relay drain; no dedicated slow-dispatch case                     | PARTIAL                                       |
| R4 Deterministic drain [MB]      | seeded backlog drains fully & uniquely (integration)     | 10/10 here + 20/20 apply                                                                            | PASS                                          |
| R5 Atomic terminal transition    | failure inside terminal tx (unit)                        | markPublished single atomic UPDATE; failure→releaseForRetry                                         | PASS                                          |
| R6 Retry/backoff/DLQ terminality | exhausted retries dead-letter, never fake-publish (unit) | archiveToDeadLetter called, markPublished NOT called                                                | PASS (relay routing); see W1 on `publishedAt` |

## Issues

### CRITICAL

None.

### WARNING

- **W1 — DLQ terminal mark sets `publishedAt`, contradicting R6 scenario text.** `OutboxClaimService.archiveToDeadLetter` (OutboxClaimService.ts:156) sets `publishedAt: new Date()` on the dead-lettered outbox row (as a "terminal / stop-polling" sentinel, alongside the `OutboxDeadLetter` row). Spec R6 scenario asserts "E ends dead-lettered with `publishedAt` unset", and merge-blocking R1's absolute wording says `publishedAt` set implies a successful dispatch. The DLQ path sets `publishedAt` after all dispatches FAILED. This is PRE-EXISTING (OutboxClaimService is unchanged by this diff), NON-REGRESSIVE (it is not the silent-loss bug — dead-lettering is explicit and auditable via the `OutboxDeadLetter` row + `failureReason`), and the relay correctly routes to DLQ instead of `markPublished`. No unit test asserts `publishedAt`-unset on the DLQ path, so the literal scenario claim is unproven and, in fact, false. Recommend: reconcile the spec wording (define `publishedAt` as a terminal sentinel = published OR dead-lettered, disambiguated by `OutboxDeadLetter`) OR introduce a distinct terminal column so a dead-lettered event is never `publishedAt`-set. Out of this change's scope; flag as follow-up.

### SUGGESTION

- **S1 — R3-S2 (lease-expiry-during-slow-dispatch) and R1-S2 (seeded orphan inbox row) lack dedicated seeded tests.** Both are satisfied by construction (orphan path code deleted) / by the generic 2-relay concurrent drain, not by a targeted case. Acceptable, but a dedicated integration case would harden coverage.
- **S2 — Fault-free exactly-once (R3-S1) asserted as `>=N` + `distinct==N`, not strict `==N`.** Deliberate: the deterministic-drain requirement (R4) explicitly replaces the flaky `===N` assertion. Noted for traceability.
- **S3 — Doc drift**: `docs/features/bulk-scheduling-redesign.md:184` still lists `OutboxInbox` dedupe as an active mechanism. Not in this change's file list; minor stale reference to sweep later.

## Final Verdict

**PASS WITH WARNINGS** — 0 CRITICAL, 1 WARNING, 3 SUGGESTION. All 4 merge-blocking behaviors (no false publish, at-least-once, atomic terminal transition, deterministic drain) are proven green by re-run tests. The single WARNING is a spec-text/pre-existing-behavior reconciliation on the DLQ `publishedAt` sentinel, not a defect introduced by this change and not a silent-loss path. Ready for archive with W1 recorded as a follow-up.
