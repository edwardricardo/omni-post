# Archive Report — outbox-dispatch-safety

> Closure record for the `outbox-dispatch-safety` SDD change. Archived 2026-07-17.
> Artifact store: **openspec** (+ engram mirror). Verify verdict: **PASS WITH WARNINGS**
> (0 CRITICAL). Ready for archive per the sdd-archive gate.

## Outcome

A silent data-loss bug in the transactional outbox relay is closed, and the CI flake it caused
is eliminated. `OutboxRelay.processClaimed` used to write the `outbox_inbox` dedupe row BEFORE
dispatching: a transient error (Prisma pool timeout under contention, pod eviction, rolling
deploy) after the inbox INSERT committed but before dispatch completed caused the next claim to
hit `P2002 → isFresh=false → markPublished` WITHOUT ever dispatching. The event was permanently
marked delivered but never delivered — violating the module's own at-least-once contract. The
SAME path made `OutboxRelay.integration.test.ts` intermittently fail under 2-relay pool
contention (events published with `dispatched=0`), blocking the unrelated verified security PR
#112. There was no test-only fix (a drain-until-count loop failed 17/20 because `markPublished`
short-circuits permanently).

**Fix (Variant B):** `processClaimed` was reordered to `build event → dispatch(event) →
markPublished()` (single atomic UPDATE), and the relay-side `OutboxInbox` was DELETED entirely.
The relay is now pure at-least-once transport (Dudycz); the claim lease + `publishedAt IS NULL`
predicate already provide all relay-side double-claim protection, and dedupe lives consumer-side
where it already exists. After the reorder, marking an undispatched event published is impossible
by construction, and any failure before the terminal UPDATE leaves `publishedAt NULL` → the event
is redelivered rather than lost. The batch tick also now tolerates a benign concurrent DLQ-race
P2002 from `archiveToDeadLetter` (already-terminal row) while still propagating any other archival
error.

## Design decision + user sign-off

- **Variant B chosen over Variant A** (keep inbox write, moved post-dispatch, atomic with
  `markPublished`). Rationale: post-reorder A and B have IDENTICAL delivery semantics in every
  crash/lease window — the inbox row would commit in the same tx as `publishedAt`, so it cannot
  survive a crash `publishedAt` does not. Variant A retains only a receipt row nothing reads plus
  P2002/orphan complexity; Variant B deletes a provably non-functional mechanism (rework over
  patches) and self-heals orphaned bug-era rows (they become inert data re-claimed and dispatched
  normally).
- **Consumer idempotency verified from code facts (design Decision 2):** all three registered
  handler families are duplicate-safe today — `IntegrationEventDeliveryHandler` (webhook POST,
  at-least-once is the standard contract, payload carries `eventId`), `TriageDispatchEventHandler`
  (`dedupeKey: triage-${messageId}` → BullMQ jobId no-op), `BulkScheduleDispatchEventHandler`
  (`dedupeKey: bulk-${batchId}-${itemId}` + reconciliation sweep). No consumer-side inbox needed
  now.
- **User sign-off:** Variant B and the tradeoff — a rare duplicate webhook in the crash-retry
  window REPLACES silent loss — was signed off by the user before apply (proposal Q1/Q2; design
  Open Question). Delivery moved from at-most-once (lossy) to at-least-once.

## Gate evidence (independently re-run at verify)

| Gate                                                                           | Result                                                                                          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Unit (`pnpm --filter @apps/api test`)                                          | 504 files / **7998 tests PASS, 0 fail, 0 cancelled**                                            |
| Typecheck (`tsc --noEmit`, 6GB heap)                                           | exit 0, **0 errors**                                                                            |
| Integration (`OutboxRelay.integration.test.ts`, 10×)                           | **10/10 GREEN** (at-least-once: dispatched>=100, distinct==100, unpublished==0); 20/20 at apply |
| Regression smoke (`bulkScheduleOutboxSmoke.test.ts`)                           | 3/3 PASS, 0 cancelled                                                                           |
| Fitness (#3 any, #4 throw, #8 sprint/phase, #9 @file, #10 @layer, #23 raw SQL) | **all 0** (hard-zero preserved; #23 confirmed untouched — no new raw SQL)                       |
| Diff size                                                                      | 193 insertions / 250 deletions across 11 files — under the 400-line budget                      |

Structural: `OutboxInbox.ts` + `OutboxInbox.test.ts` deleted; `TOKENS.OutboxInbox` removed from
`container/types.ts`; DI registration/injection removed from `setupCrisisUseCases.ts`; 0 residual
`OutboxInbox`/`outbox_inbox`/`consumerId` references in `apps/api/src` + `apps/api/tests`.

## Capabilities / specs applied

New capability — no prior living spec existed. The delta spec was established as the cumulative
living specification:

- `outbox-event-delivery` → `openspec/specs/outbox-event-delivery/spec.md` (created)

The living spec carries the corrected `publishedAt` framing: it is the terminal stop-polling
sentinel reached by successful dispatch (`markPublished`) OR exhausted-retry dead-lettering
(`archiveToDeadLetter`, which ALSO writes a durable `OutboxDeadLetter` row in the same
transaction). A dead-lettered event is disambiguated from a successful delivery by the presence
of its `OutboxDeadLetter` record — closing the W1 spec-text tension for the go-forward spec.
6 requirements (4 tagged `[MERGE-BLOCKING]`) / 8 Given/When/Then scenarios, RFC-2119 normative.

## Flagged follow-ups (out of this change's scope)

1. **Drop the inert `OutboxInbox` Prisma model + `outbox_inbox` table.** No relay code writes it
   anymore (dead model). The `schema.prisma` model and its tenant-guard row in
   `docs/security/MULTI_TENANT_GUARDS.md:388` were intentionally KEPT (annotated dead-model,
   removal deferred) to avoid coupling a schema/table drop into this behavior change. A dedicated
   follow-up migration change should remove the model and the table.
2. **DLQ `publishedAt`-sentinel spec-vs-column question (verify W1).**
   `OutboxClaimService.archiveToDeadLetter` (pre-existing, unchanged by this diff) sets
   `publishedAt` on dead-lettered rows as a stop-polling sentinel alongside the `OutboxDeadLetter`
   row. The living spec resolves this at the wording level (sentinel = published OR
   dead-lettered, disambiguated by `OutboxDeadLetter`). A follow-up may instead introduce a
   distinct terminal column so a dead-lettered event is never `publishedAt`-set, and add a unit
   test asserting the DLQ path's `publishedAt`/`OutboxDeadLetter` invariant directly.
3. **Minor doc drift (verify S3):** `docs/features/bulk-scheduling-redesign.md:184` still lists
   `OutboxInbox` dedupe as an active mechanism — sweep in a later docs pass.
4. **Coverage hardening (verify S1):** dedicated seeded integration cases for
   lease-expiry-during-slow-dispatch (R3-S2) and the orphaned-inbox-row path (R1-S2), currently
   satisfied by construction / the generic 2-relay drain rather than targeted tests.

## Traceability

- Verify report: `openspec/changes/archive/outbox-dispatch-safety/verify-report.md` (verdict PASS
  WITH WARNINGS, 0 CRITICAL / 1 WARNING / 3 SUGGESTION).
- Engram: bug root cause obs #352 (topic `bug/outbox-relay-inbox-before-dispatch-loss`);
  apply-progress obs #357. Archive summary mirrored to engram under topic
  `sdd/outbox-dispatch-safety/archive-report`.
- All 24 implementation tasks checked and matched to code state at verify.

## Merge reference

- Branch: `fix/outbox-dispatch-safety` (Variant B implemented and committed; git ownership /
  PR handled by the orchestrator).
- Unblocks: PR #112 (required Integration Tests check — the flake root cause is removed).
- Date archived: **2026-07-17**.
