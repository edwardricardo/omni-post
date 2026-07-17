# Proposal: Outbox Dispatch Safety

## Intent

`OutboxRelay.processClaimed` (apps/api/src/infrastructure/outbox/OutboxRelay.ts:98-137) writes the `outbox_inbox` dedupe row BEFORE dispatching. Loss scenario: worker claims event E; `tryClaimForProcessing(E)` INSERT commits; a transient error (Prisma pool timeout under contention, pod eviction, rolling deploy) hits before dispatch completes; the non-P2002 error re-throws (OutboxInbox.ts:53) → catch → `releaseForRetry`. On the next claim, `tryClaimForProcessing(E)` → P2002 → `isFresh=false` → `markPublished` WITHOUT dispatch (OutboxRelay.ts:104-110). E is permanently marked delivered but was never delivered — silent data loss violating the module's own at-least-once contract (OutboxInbox.ts JSDoc header).

The SAME root cause makes the required Integration Tests CI check flaky: `apps/api/tests/integration/outbox/OutboxRelay.integration.test.ts` intermittently exercises exactly this path under 2-relay pool contention (diagnostic-instrumented failures: `dispatched=0/25/50, pendingRows=0` — events published without ever being dispatched). It currently blocks the verified, unrelated security PR #112 (Slice 0 DELETE-ownership). There is NO test-only fix (drain-until-count loop failed 17/20 — `markPublished` short-circuits permanently). Evidence: engram obs #352, topic `bug/outbox-relay-inbox-before-dispatch-loss`. Fixing the production ordering closes the data loss AND stabilizes the required check for all PRs.

## Proposal question round

> Executor could not ask interactively — user review requested before/at design.

1. **Duplicate vs loss**: is a rare duplicate dispatch acceptable for every current consumer (`IntegrationEventDeliveryHandler`, `TriageDispatchEventHandler`, other registered handlers), or does any trigger non-idempotent external side effects where a duplicate is worse than the current silent loss?
2. **Where should dedupe live**: relay-side receipt row (keep inbox write, post-dispatch) or consumer-side inbox (canonical Dudycz placement)?
3. **Production exposure**: has this relay run anywhere that requires an incident audit of falsely-published rows (they are indistinguishable retroactively)?
4. **Urgency coupling**: should this change be the next slice, ahead of other queued work, given it gates PR #112?

**Assumptions if unanswered**: at-least-once is correct — ARCHITECTURE_CANON §Event-Driven already mandates "every consumer handler is idempotent", and OutboxRelay's JSDoc claims at-least-once delivery; A-vs-B (below) is decided in design; no production incident audit needed (pre-prod).

## Scope

### In Scope

- Reorder `processClaimed`: dispatch first; then ONE transaction writing the `outbox_inbox{messageId}` record atomically with `publishedAt` (typed Prisma `$transaction`, no new raw SQL).
- Fix the misleading comment at OutboxRelay.ts:105-108 ("the side effects already occurred" — currently false).
- Update the integration test assertion from exactly-once (`dispatched.length === EVENT_COUNT`) to at-least-once with no consumer-observed duplicates (`>= EVENT_COUNT` and `unique.size === EVENT_COUNT`).
- Unit tests covering the crash window (error after inbox/dispatch boundary) proving no event can be marked published undispatched.
- Idempotency assessment of current dispatch targets (design-phase input).
- Handling of pre-existing orphaned inbox rows (see Risks).

### Out of Scope

- Broader saga work; outbox feature additions (metrics, DLQ redrive, schema changes).
- Implementing a consumer-side inbox if the assessment shows one is needed (separate follow-up change).
- PR #112 content; any other CI flake.

## Capabilities

### New Capabilities

- `outbox-event-delivery`: delivery guarantees of the transactional outbox relay — atomic claim/lease, dispatch ordering, dedupe, retry/backoff, DLQ terminality.

### Modified Capabilities

- None (no existing spec covers the outbox).

## Approach

Dispatch the event, then commit `outbox_inbox` insert + `markPublished` in a single transaction. After the reorder, `isFresh=false` genuinely means "already dispatched", making the short-circuit branch correct.

**Central open question for the design phase (deliberately NOT decided here).** The current pre-dispatch inbox claim gives at-MOST-once dispatch at the relay — a crash loses events (the bug). Post-dispatch write gives at-LEAST-once — a crash between dispatch and the tx causes redelivery on retry, pushing idempotency to consumers. This matches the Dudycz "Outbox + Inbox" pattern the code header cites (outbox = at-least-once transport; inbox = CONSUMER-side dedupe — the relay writing the inbox pre-dispatch misapplies the pattern at the producer side). Two variants for design to weigh:

| Variant                       | Mechanics                                                                                                                      | Tradeoff                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **A — reorder**               | Keep inbox write, moved AFTER dispatch, atomic with `markPublished`                                                            | Retains a dispatch receipt row; must handle P2002 on orphaned rows (upsert or cleanup) |
| **B — drop relay-side inbox** | Remove inbox interaction from the relay; claim lease + `publishedAt` already bound double dispatch; inbox belongs to consumers | Less code, same at-least-once window; loses the receipt row; orphans become irrelevant |

Consequences either way: test assertion becomes at-least-once shaped; consumers must be verified idempotent (canon requires it — design verifies reality).

## Affected Areas

| Area                                                                | Impact                                      | Description                                            |
| ------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| `apps/api/src/infrastructure/outbox/OutboxRelay.ts`                 | Modified                                    | Reorder `processClaimed`; fix comment                  |
| `apps/api/src/infrastructure/outbox/OutboxInbox.ts`                 | Modified (Variant A) or trimmed (Variant B) | Transactional/upsert write, or removal from relay path |
| `apps/api/tests/integration/outbox/OutboxRelay.integration.test.ts` | Modified                                    | At-least-once assertions                               |
| `apps/api/tests/unit/**/outbox/**`                                  | New/Modified                                | Crash-window regression tests                          |

## Risks

| Risk                                                                                                    | Likelihood           | Mitigation                                                                                              |
| ------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| Redelivery to a non-idempotent consumer                                                                 | Med                  | Design-phase idempotency assessment of all registered handlers; canon already mandates idempotency      |
| Orphaned bug-era inbox rows: post-dispatch insert hits P2002 → tx fails → retry → redispatch loop → DLQ | Med (Variant A only) | Upsert semantics or one-time orphan cleanup (inbox row present, event unpublished); N/A under Variant B |
| Transaction boundary wrong (inbox insert and `markPublished` not atomic) recreates a loss/dup window    | Low                  | Single typed `$transaction`; unit test the failure injection                                            |
| Lease expiry during a slow dispatch causes concurrent redispatch                                        | Low                  | Pre-existing behavior, unchanged; covered by uniqueness assertion                                       |

## Fitness function interaction

- **#23** (raw queries): fix uses the typed Prisma API — no new raw SQL, no new exception.
- **#8/#9/#3/#4**: comment hygiene, `@file` headers, no `any`, throws confined to infrastructure — all edited files stay compliant.

## Rollback Plan

Single-commit revert. No schema or data migration involved. Reverting restores the known prior state (flaky test + loss window), never a new failure mode. If Variant A ships an orphan cleanup script, it is idempotent and needs no reverse migration.

## Dependencies

- None external. Unblocks: PR #112 (required Integration Tests check).

## Success Criteria

- [ ] No code path can mark an undispatched event published (unit test injecting a failure between dispatch and the atomic commit).
- [ ] Integration test green 20/20 consecutive runs under 2-relay contention.
- [ ] No duplicate consumer observations in the integration test (`unique.size === EVENT_COUNT`).
- [ ] All CI fitness functions remain hard-zero; lint/typecheck at 0/0.

## Review Workload Forecast

Estimated ~150–250 changed lines (relay ~40, inbox ±20, integration test ~20, unit tests ~80–150). Fits ONE reviewable PR under the 400-line budget. Chained PRs recommended: No. 400-line budget risk: Low. Decision needed before apply: Yes — the A/B variant and idempotency question must be settled in design first.
