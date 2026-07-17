# Outbox Event Delivery — Specification

> Living specification for the **outbox-event-delivery** capability: the delivery
> guarantees of the transactional outbox relay — atomic claim/lease, dispatch ordering,
> dedupe, retry/backoff, and DLQ terminality. Per ARCHITECTURE_CANON §Event-Driven
> Architecture ("after dispatch, mark event PROCESSED atomically"; "every consumer handler
> is idempotent").
>
> Established by change `outbox-dispatch-safety` (Variant B — reorder `processClaimed` to
> `dispatch → markPublished` and delete the relay-side `OutboxInbox`; the relay is now pure
> at-least-once transport, dedupe lives consumer-side). Archived 2026-07-17.
>
> **Terminal sentinel semantics.** `publishedAt` is the terminal stop-polling sentinel,
> reached by EITHER a successful dispatch (`markPublished`) OR exhausted-retry
> dead-lettering (`archiveToDeadLetter`, which ALSO writes a durable `OutboxDeadLetter` row
> in the same transaction). A dead-lettered event is disambiguated from a successful
> delivery by the presence of its `OutboxDeadLetter` record — `publishedAt` alone does not
> imply success.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements tagged
> **[MERGE-BLOCKING]** MUST be proven green before merge.

---

## Requirements

### Requirement: No false delivery — terminal delivery implies completed dispatch [MERGE-BLOCKING]

`publishedAt` is the terminal stop-polling sentinel, reached by EITHER a successful dispatch
(`markPublished`) OR exhausted-retry dead-lettering (`archiveToDeadLetter`, which ALSO writes a
durable `OutboxDeadLetter` row in the same transaction). An outbox event MUST NOT reach terminal
state AS A SUCCESSFUL DELIVERY — `publishedAt` set with NO corresponding `OutboxDeadLetter`
record — unless its dispatch to the event dispatcher completed successfully at least once. No
relay-side state (dedupe/inbox row, claim, lease) MAY on its own cause a retry to mark an
undispatched, non-dead-lettered event published. (Historical: the pre-fix bug violated this — a
transient error after the pre-dispatch inbox write made the retry short-circuit to
published-without-dispatch and without a dead-letter record; the relay-side inbox was removed to
close it.)

#### Scenario: transient error before dispatch completes never fakes delivery [unit]

- GIVEN a claimed event E whose dispatch has NOT completed
- WHEN a transient error (pool timeout, crash, eviction) aborts processing and E is later re-claimed
- THEN the retry dispatches E before any terminal publish mark — E is never published undispatched

#### Scenario: orphaned bug-era inbox row is re-processed safely [integration]

- GIVEN a pre-existing `outbox_inbox` row for event E while E is still unpublished
- WHEN a relay claims and processes E
- THEN E is dispatched at least once and reaches published — the orphan neither short-circuits dispatch nor causes a retry/DLQ loop

### Requirement: At-least-once delivery [MERGE-BLOCKING]

Every persisted outbox event SHALL be dispatched at least once before reaching terminal
publish. A crash between successful dispatch and the terminal write SHALL cause redelivery
on retry — never silent loss.

#### Scenario: crash window between dispatch and terminal commit [unit]

- GIVEN dispatch of event E completed and a failure is injected before the terminal commit
- WHEN the relay retries E
- THEN E is redelivered and eventually published — E is never both (a) marked published and (b) never dispatched

### Requirement: Exactly-once dispatch in the fault-free path

Under concurrent relays with no faults, each event SHALL be dispatched exactly once across
all relays — the atomic claim/lease MUST prevent double-claim of a live-leased event.
Consumer-observed duplicates MAY occur only on genuine crash-retry or lease expiry and MUST
be absorbed by idempotent consumers (canon-mandated).

#### Scenario: happy-path concurrent drain has no duplicates [integration]

- GIVEN N pending events and two relays draining concurrently with no injected faults
- WHEN both relays drain to completion
- THEN each event was dispatched exactly once (total dispatch count == N)

#### Scenario: lease expiry during a slow dispatch duplicates, never loses [integration]

- GIVEN relay 1's lease on event E expires while its dispatch is still in flight
- WHEN relay 2 claims and dispatches E
- THEN E is dispatched >= 1 time and terminally published once — the duplicate is absorbed downstream, distinct-event delivery preserved

### Requirement: Deterministic drain under concurrency [MERGE-BLOCKING]

Two concurrent relays draining a seeded backlog of N events SHALL reach terminal state
(published) for every event, with total dispatch count >= N and distinct dispatched-event
count == N. The drain MUST terminate — no event stays permanently pending/claimed absent a
genuine handler failure. (This replaces the flaky exactly-once `=== N` test assertion.)

#### Scenario: seeded backlog drains fully and uniquely [integration]

- GIVEN N seeded pending outbox events and two relays polling concurrently
- WHEN the relays run until no claimable work remains
- THEN all N events are published, total dispatches >= N, distinct dispatched event ids == N (stable 20/20 consecutive runs)

### Requirement: Atomic terminal transition

The terminal publish mark and any relay-side delivery receipt (if the design retains one)
SHALL commit in a single transaction. No post-commit state MAY imply delivery while the
event is unpublished, or vice versa.

#### Scenario: failure inside the terminal transaction leaves no half state [unit]

- GIVEN dispatch of E completed and a failure is injected during the terminal transaction
- WHEN the transaction aborts
- THEN neither the terminal mark nor any receipt persists; retry redelivers per at-least-once

### Requirement: Retry, backoff, and DLQ terminality preserved

A dispatch failure SHALL release the event for retry with backoff; exhausted retries SHALL
end in the terminal DLQ state — never in a false published state.

#### Scenario: exhausted retries dead-letter, never fake-publish [unit]

- GIVEN event E whose dispatch fails on every attempt
- WHEN the retry budget is exhausted
- THEN E ends dead-lettered — a durable `OutboxDeadLetter` row is written and `publishedAt` is set as the terminal stop-polling sentinel (E is not re-claimed and is never recorded as a successful delivery)
