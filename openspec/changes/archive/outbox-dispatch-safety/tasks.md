# Tasks: Outbox Dispatch Safety (Variant B)

> STRICT TDD: every production change is preceded by its failing (RED) test.
> Design decision settled — Variant B: reorder `processClaimed` to
> `build event → dispatch(event) → markPublished()` (single atomic UPDATE) and
> DELETE the relay-side `OutboxInbox`. Delivery becomes at-least-once.

## Review Workload Forecast

| Field                   | Value                                                |
| ----------------------- | ---------------------------------------------------- |
| Estimated changed lines | ~300–350 (incl. deletions; ~130 authored additions)  |
| 400-line budget risk    | Low                                                  |
| Chained PRs recommended | No                                                   |
| Suggested split         | Single PR (all changes atomic; single-commit revert) |
| Delivery strategy       | ask-on-risk                                          |
| Chain strategy          | pending (no chaining needed — under budget)          |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: RED — Unit specs (`apps/api/tests/unit/outbox/OutboxRelay.test.ts`)

- [x] 1.1 Remove the `inbox` mock and construct `OutboxRelay` without the `inbox` option in the test factory (reflects new signature — suite goes RED).
- [x] 1.2 Add failing test: `markPublished` runs only AFTER `dispatch` resolves — assert `dispatch.mock.invocationCallOrder[0] < markPublished.mock.invocationCallOrder[0]` (Req: No false publish / Atomic terminal).
- [x] 1.3 Add failing test: `dispatch` rejects → `markPublished` NOT called AND `releaseForRetry` called with `retryCount+1` (Req: No false publish / Retry-backoff).
- [x] 1.4 Add failing test: `markPublished` rejects after `dispatch` resolves → `releaseForRetry` called, event stays unpublished/redelivered (Req: At-least-once).
- [x] 1.5 Keep existing DLQ-on-exhausted-retries test, adapted to no-inbox options (Req: Retry/DLQ terminality preserved).

## Phase 2: GREEN — Production reorder (`apps/api/src/infrastructure/outbox/OutboxRelay.ts`)

- [x] 2.1 Remove `import type { OutboxInbox }` (L31) and `inbox: OutboxInbox` from `OutboxRelayOptions` (L39). (Also removed the now-dead `consumerId` option — it was only ever read by the inbox branch.)
- [x] 2.2 Rewrite `processClaimed`: delete `tryClaimForProcessing`/`isFresh` branch + misleading comment (L100–110); body = build event → `dispatch(event)` → `markPublished(row.id)`; keep `catch` (retry/DLQ) unchanged.
- [x] 2.3 Fix header JSDoc (L11–14): drop the layer-2 "Consumer dedupe via OutboxInbox" claim; restate as at-least-once transport, dedupe consumer-side. Run unit suite → Phase 1 GREEN.

## Phase 3: Delete OutboxInbox + DI cleanup

- [x] 3.1 Delete `apps/api/src/infrastructure/outbox/OutboxInbox.ts`.
- [x] 3.2 Delete `apps/api/tests/unit/outbox/OutboxInbox.test.ts`.
- [x] 3.3 Remove `TOKENS.OutboxInbox` from `apps/api/src/infrastructure/container/types.ts`.
- [x] 3.4 Remove `OutboxInbox` registration + injection into `OutboxRelay` in `setupCrisisUseCases.ts` (~L55–71). `tsc` + unit → GREEN.

## Phase 4: Integration test (`apps/api/tests/integration/outbox/OutboxRelay.integration.test.ts`)

- [x] 4.1 Remove inbox setup/wiring and all `outbox_inbox` row-count assertions.
- [x] 4.2 Replace exactly-once (`=== N`) asserts with at-least-once: `dispatched.length >= EVENT_COUNT && unique.size === EVENT_COUNT && unpublished === 0` (Req: Deterministic drain / At-least-once).
- [x] 4.3 Confirm the test STAYS in the `integration:outbox` batch (`run-tests.sh:156–157`) — do NOT move to `integration:tenant-isolation`. Run outbox batch → GREEN.

## Phase 5: Test helper cleanup

- [x] 5.1 `tests/integration/helpers/bulkScheduleHarness.ts`: drop inbox construction/wiring (L18, L73, L148); build `OutboxRelay` without `inbox`.
- [x] 5.2 `tests/integration/bulkScheduleOutboxSmoke.test.ts`: retitle scenario 2 — operative mechanism is the `publishedAt IS NULL` claim predicate, not the inbox; drop inbox references. Run smoke → GREEN.

## Phase 6: Doc reconciliation

- [x] 6.1 `docs/observability/SLO.md` (L53–55): correct the "zero-duplicate-publish via OutboxInbox `messageId` unique" claim — dedupe is the atomic claim/lease + `publishedAt` predicate; crash-retry duplicates are absorbed by idempotent consumers (at-least-once).
- [x] 6.2 `docs/security/MULTI_TENANT_GUARDS.md` (L388): reconcile — the `OutboxInbox` Prisma model persists in `schema.prisma` until the follow-up drop migration, so the tenant-scoped table entry STAYS; add a note that no relay code writes it anymore (dead model, removal deferred). Do NOT delete the row.

## Phase 7: P2002 race edge (gate-flagged)

- [x] 7.1 Assess `archiveToDeadLetter` `$transaction` (`OutboxClaimService.ts:136–142`) under a 2-relay lease-expiry race: both relays exhaust retries on the same row → concurrent `outboxDeadLetter.create` → P2002 propagates out of `processClaimed` and aborts the rest of the batch tick (more reachable without the inbox short-circuit).
- [x] 7.2 Decision: GUARDED (clean). `processClaimed`'s catch now swallows a P2002 from `archiveToDeadLetter` (benign already-terminal — a concurrent relay dead-lettered the row under lease expiry) and continues the batch; any other archival error still propagates for a lease-expiry retry. RED unit test added first (`tolerates a concurrent DLQ-race unique violation (P2002)`), plus a pinned test that non-P2002 archival errors still propagate.

## Phase 8: Final gate

- [x] 8.1 Run `OutboxRelay.integration.test.ts` 20× consecutively under 2-relay contention → 20/20 GREEN (Req: Deterministic drain, stable 20/20). Fixture pre-leases rows so a locally running `dev:api` relay on the shared DB cannot contaminate the drain; the two test relays still race via SKIP LOCKED.
- [x] 8.2 Full 0/0: `lint --max-warnings 0`, `tsc`, 24 fitness checks (confirm #23 raw-SQL untouched), unit + integration (LXC-safe); grep confirms no residual `OutboxInbox` code references outside `schema.prisma`.
