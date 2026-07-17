# Design: Outbox Dispatch Safety

## Technical Approach

**Variant B**: reorder `processClaimed` to dispatch-then-mark-published and REMOVE the relay-side inbox entirely. Evidence: `OutboxInbox` is consumed ONLY by `OutboxRelay.processClaimed` (production references: OutboxRelay.ts:100, DI registration setupCrisisUseCases.ts:55-71, rest are tests/docs — repo-wide grep). The claim lease + `publishedAt IS NULL` predicate (OutboxClaimService.claim, OutboxClaimService.ts:88-99) already provides all relay-side double-claim protection. The relay becomes pure at-least-once transport (Dudycz); dedupe lives consumer-side, where it already exists.

## Architecture Decisions

### Decision 1: Variant B — drop the relay-side inbox (RECOMMENDED)

**Choice**: delete `OutboxInbox` from the relay path; `processClaimed` = build event → `dispatch()` → `markPublished()`.
**Alternative rejected**: Variant A (keep inbox write, post-dispatch, atomic with `markPublished`).
**Rationale**: post-reorder, A and B have IDENTICAL delivery semantics in every window — the inbox row commits in the same tx as `publishedAt`, so it cannot survive a crash that `publishedAt` does not survive:

| Window                                       | Variant A                                                                                       | Variant B                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------- |
| Crash before dispatch                        | no writes → re-claim → redispatch                                                               | same                              |
| Crash after dispatch, before terminal commit | inbox row rolls back with tx → redelivery (duplicate) anyway                                    | same duplicate                    |
| Lease expiry during slow dispatch (>5 min)   | 2nd relay dispatches before any row exists → duplicate; loser hits P2002 → needs upsert         | same duplicate; no P2002 handling |
| Normal path                                  | receipt row written; `isFresh=false` branch is dead code (`publishedAt` filter blocks re-claim) | single UPDATE                     |

A retains only a receipt row nothing reads, plus P2002/orphan complexity. B deletes a provably non-functional mechanism (rework over patches) and self-heals orphans (Decision 3). Note `OutboxInbox`'s unique-on-`messageId` ("processed by ANY consumer") is also wrong for a real multi-consumer inbox — not worth preserving.

### Decision 2: Consumer idempotency — at-least-once is acceptable AS-IS (code facts)

Production dispatcher is plain `InMemoryEventDispatcher` (`index.ts` never passes `integrationEventPublisher`; `ComposedEventDispatcher` is not in the relay path). Exactly three handler families are registered (index.ts:772-793):

| Handler                            | Events                     | Side effect                                                                                           | Duplicate-safe?                                                                                                                                                |
| ---------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IntegrationEventDeliveryHandler`  | 11 `post.*` types          | HTTP POST per `IntegrationSubscription` (`TriggerIntegrationEventService.fire`, allSettled, no state) | YES with caveat: rare duplicate webhook to external subscribers; payload carries `eventId` for receiver dedupe; at-least-once is the standard webhook contract |
| `TriageDispatchEventHandler`       | `SocialMessageReceived`    | BullMQ enqueue, `dedupeKey: triage-${messageId}` → `jobId` (queue-adapter.ts:83)                      | YES — same jobId is a no-op                                                                                                                                    |
| `BulkScheduleDispatchEventHandler` | `BulkScheduleRowConfirmed` | enqueue, `dedupeKey: bulk-${batchId}-${itemId}`                                                       | YES + reconciliation sweep backstop                                                                                                                            |

**Verdict**: no consumer-side inbox needed now. `Promise.all` partial-handler failure already re-runs succeeded handlers today, so idempotency was already load-bearing. Caveat: BullMQ jobId dedupe holds only while the prior job is retained in Redis — redelivery window (seconds of backoff) is far inside retention. **Follow-up (flagged, NOT this change)**: any future handler with non-idempotent external effects requires a consumer-side inbox (`messageId + consumerId`).

### Decision 3: Orphaned bug-era inbox rows — no cleanup needed

**Choice**: none required. Under B the P2002 short-circuit disappears; an unpublished event with an orphaned inbox row is simply re-claimed and dispatched (self-healing the loss). Orphan rows become inert data in a table nothing reads. **Rejected**: upsert semantics, cleanup script (both A-only). Schema/table drop is out of scope — flag a follow-up migration change to remove the `OutboxInbox` model.

### Decision 4: Terminal write — single UPDATE, no `$transaction`

`markPublished` (one atomic `UPDATE ... SET publishedAt, claimedAt=NULL, claimedBy=NULL`) is the entire terminal write. Proof of safety: `publishedAt` is set ONLY after `dispatch()` resolves → marking-undispatched-as-published is impossible; any failure before the UPDATE commits leaves `publishedAt NULL` → redelivery (duplicate bounded by Decision 2). `archiveToDeadLetter` keeps its existing `$transaction`. No new raw SQL (fitness #23 untouched).

## Data Flow

    claim (SKIP LOCKED + lease) ──→ dispatch(event) ──→ markPublished (atomic UPDATE)
                                        │ throws                │ throws
                                        └── releaseForRetry / DLQ (unchanged) — publishedAt stays NULL → redelivered

## File Changes

| File                                                                | Action | Description                                                                                             |
| ------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `apps/api/src/infrastructure/outbox/OutboxRelay.ts`                 | Modify | Remove `inbox` option + `isFresh` branch + misleading comment (105-108); fix header JSDoc layer-2 claim |
| `apps/api/src/infrastructure/outbox/OutboxInbox.ts`                 | Delete | Mechanism provides no protection post-reorder                                                           |
| `apps/api/src/infrastructure/container/setupCrisisUseCases.ts`      | Modify | Drop `OutboxInbox` registration + injection                                                             |
| `apps/api/src/infrastructure/container/types.ts`                    | Modify | Remove `TOKENS.OutboxInbox`                                                                             |
| `apps/api/tests/unit/outbox/OutboxRelay.test.ts`                    | Modify | Drop inbox mock; add crash-window tests                                                                 |
| `apps/api/tests/unit/outbox/OutboxInbox.test.ts`                    | Delete | Class removed                                                                                           |
| `apps/api/tests/integration/outbox/OutboxRelay.integration.test.ts` | Modify | At-least-once assertions; drop inbox setup/asserts                                                      |
| `apps/api/tests/integration/helpers/bulkScheduleHarness.ts`         | Modify | Drop inbox wiring (lines 18, 73, 148)                                                                   |
| `apps/api/tests/integration/bulkScheduleOutboxSmoke.test.ts`        | Modify | Retitle scenario 2 — operative mechanism is the `publishedAt` claim predicate, never the inbox          |
| `docs/observability/SLO.md`                                         | Modify | Correct the "zero-duplicate-publish via OutboxInbox" claim (line 55)                                    |

## Testing Strategy

| Layer                   | What to Test                                                                                               | Approach                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Unit (Vitest)           | `markPublished` called only after `dispatch` resolves                                                      | mock call-order assertion (invocationCallOrder)                                              |
| Unit                    | dispatch throws → NO `markPublished`, `releaseForRetry` called                                             | reject `dispatch` mock                                                                       |
| Unit                    | `markPublished` throws after dispatch → `releaseForRetry` (redelivery, never loss)                         | reject `markPublished` mock                                                                  |
| Unit                    | DLQ on exhausted retries unchanged                                                                         | existing tests kept                                                                          |
| Integration (node:test) | 2-relay contention: `dispatched.length >= EVENT_COUNT && unique.size === EVENT_COUNT && unpublished === 0` | replace exactly-once asserts; remove `outboxInbox` row-count assert; 20/20 consecutive green |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. In-process DB write-ordering change.

## Migration / Rollout

No migration. Single-commit revert restores prior state. ~300–350 changed lines including deletions (~130 authored additions) — one PR, under the 400 budget.

## Open Questions

- [ ] User sign-off: Variant B + acceptance that a rare duplicate webhook (crash-retry window) replaces silent loss — proposal Q1/Q2. Non-blocking for tasks; blocking for apply.
