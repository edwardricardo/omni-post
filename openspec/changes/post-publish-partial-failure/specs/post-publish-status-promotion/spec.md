# Delta for post-publish-status-promotion — the partial outcome is RECORDED, not refused (post-publish-partial-failure)

> N-COR-1 (`post-publish-status-integrity`) closed the TOTAL-success path and left the non-total one
> as a NAMED SEAM: its R3 refuses any outcome short of total with `NOT_IMPLEMENTED`, naming N-COR-8
> in the message (`CompletePostPublishingUseCase.ts:146-153`; the string is at `:149-150` in the
> tree). This delta fills that seam. Three requirements change and **nothing else does** — the
> remaining seven requirements of that capability are REUSED verbatim, not restated.
>
> **Ordering dependency, stated plainly.** The capability's main spec still lives under
> `openspec/changes/post-publish-status-integrity/specs/` because N-COR-1 has not archived.
> **N-COR-1 MUST archive before this delta archives**, or the archive step has no requirement block
> to replace.
>
> | Requirement                                               | Change                                                                                                                                                                                                                                                  |
> | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | R1 — total success reaches `PUBLISHED` in one transaction | EXTENDED: the one transaction now also covers the per-channel publication records; the `PUBLISHING`-is-not-a-resting-state clause is scoped to a SUCCESSFUL promotion, because a non-total outcome now legitimately rests in the in-progress projection |
> | R3 — anything short of total success is REFUSED           | REPLACED: a non-total outcome is RECORDED per channel and the status is DERIVED; the fail-closed refusal of an UNKNOWABLE outcome is kept unchanged                                                                                                     |
> | R4 — re-application is idempotent                         | EXTENDED: idempotency now holds PER CHANNEL as well as for the post                                                                                                                                                                                     |
>
> R3 and R4 also change their HEADINGS, so both are declared in `## RENAMED Requirements` at the end
> of this file; the archive renames the old block and then applies the MODIFIED body under the new
> name.
>
> Scenario tags are N-COR-1's: `[integration]`, `[unit]`, `[static]`.

---

## MODIFIED Requirements

### Requirement: A total-success publish-now reaches PUBLISHED through the aggregate, in one transaction **[MERGE-BLOCKING]**

(Previously: the one transaction covered the post row and the outbox only, and `PUBLISHING` was
stated as never a durable resting state without qualification. The transaction now also covers the
per-channel publication records this change introduces, and the resting-state clause is scoped to a
SUCCESSFUL promotion, because a non-total outcome rests in the in-progress projection by design.)

When every channel a publish-now saga scheduled has published, the post SHALL reach the persisted
state `PUBLISHED`, SHALL carry a non-null `publishedAt`, and SHALL have `PostPublished` recorded in
the outbox **in the same database transaction as the state mutation**.

The transition SHALL be performed by the aggregate's own promotion methods, in the order the state
machine requires (`DRAFT → PUBLISHING → PUBLISHED`), inside ONE Unit of Work. No field SHALL be
written directly on the repository, and the post SHALL be loaded and saved once within that
transaction.

**That single transaction SHALL also carry the post's per-channel publication records.** The post
row, its records and the outbox are one multi-statement save; a failure after the first statement
SHALL roll all of it back, signalled through the `Result`-aware transaction seam (ADR-0023) rather
than by a `throw` crossing a layer boundary.

The commit SHALL be all-or-nothing: a failure at any point leaves the post exactly as it was, with
no event in the outbox, no `publishedAt`, and no record change. `PUBLISHING` SHALL NOT be observable
as a durable resting state **of a successful promotion** — there it is an intermediate hop inside the
transaction. A post with at least one unresolved channel legitimately RESTS in the in-progress
projection; that is not a promotion, and this clause does not forbid it.

The promotion SHALL write no field other than the status, the publication timestamp, the per-channel
records, and the aggregate's own bookkeeping: content present at load time SHALL be identical after
the promotion.

#### Scenario: a publish-now whose channels all succeed lands PUBLISHED [integration]

- **GIVEN** a publish-now saga for a DRAFT post whose scheduled channels all report a successful publish
- **WHEN** the saga runs to a terminal state
- **THEN** reading the row back yields `status = PUBLISHED` and a non-null `publishedAt`, and the saga reports COMPLETED

#### Scenario: the event is in the outbox, written by the same transaction [integration]

- **GIVEN** the promotion above
- **WHEN** the outbox is read
- **THEN** exactly one `PostPublished` row exists for that post, and no committed state exists in which the status is PUBLISHED without it or the event exists without the status

#### Scenario: the per-channel records commit with the promotion [integration]

- **GIVEN** the promotion above
- **WHEN** the records are read back
- **THEN** every intended channel carries a published outcome, and no committed state exists in which the post is PUBLISHED while a record still reads unresolved

#### Scenario: a failed commit leaves nothing behind [integration]

- **GIVEN** a promotion whose transaction fails after the aggregate has been mutated in memory
- **WHEN** the row, the records and the outbox are read back
- **THEN** the status is unchanged, `publishedAt` is null, no record changed, and no `PostPublished` row exists

#### Scenario: the transition goes through the aggregate, not through a field write [static]

- **GIVEN** the change is applied
- **WHEN** the promotion use case is inspected
- **THEN** it calls the aggregate's promotion methods for both hops, persists through the repository port inside one Unit of Work, and issues no direct status or timestamp write and no transaction of its own

#### Scenario: the previously dead promotion path is live [static]

- **GIVEN** the change is applied
- **WHEN** `startPublishing` and `markAsPublished` are searched across production source
- **THEN** each has at least one production caller

---

### Requirement: The command carries the publish outcome, and a NON-TOTAL outcome is RECORDED **[MERGE-BLOCKING]**

(Previously: a non-total outcome was REFUSED with an error `Result` that wrote nothing, as an
explicitly named seam pending N-COR-8. It is now RECORDED per channel and the post's status is
DERIVED from the record. The fail-closed refusal of an outcome that cannot be ESTABLISHED is
unchanged — ignorance is still refused; only KNOWN partiality stops being a refusal.)

The status-transition command SHALL carry the publish OUTCOME: the set of channels the saga
scheduled, and for each one whether it published, and when it did not, the cause. A **total success**
is every scheduled channel reporting success; nothing else is.

A NON-TOTAL outcome SHALL be RECORDED, not refused: each channel's result SHALL be written to its
publication record, and the post's status SHALL follow the derivation this change's
`post-channel-publication-record` capability defines — every channel published gives `PUBLISHED`;
any channel unresolved leaves the post in progress; a resolved outcome with at least one exclusion
and at least one publication gives `PARTIALLY_PUBLISHED`. The promotion SHALL NOT invent a status
beside the record, and SHALL NOT set `publishedAt` for anything but a total success.

The refusal SHALL remain FAIL-CLOSED over IGNORANCE: when the scheduled channel set or the
per-channel outcomes cannot be established, or the scheduled set is empty, the promotion SHALL be
refused, write nothing, and return an error `Result`. An outcome that cannot be SHOWN is not an
outcome — and after this change that includes a post carrying NO publication record at all, which a
pre-existing saga will present.

A refused promotion SHALL NEVER return a success — the silent success is the defect this capability
exists to delete, and recording a partial outcome does not relax it: a partial that could not be
WRITTEN is a failure, not a partial.

#### Scenario: one channel short of total is recorded, not refused [integration]

- **GIVEN** a promotion whose outcome reports three scheduled channels, two successful and one failed for a problem of its own
- **WHEN** it executes
- **THEN** it returns success, the two successes and the one exclusion are persisted on their records, the post derives `PARTIALLY_PUBLISHED`, and `publishedAt` is null

#### Scenario: an unknowable outcome is refused, not assumed [unit]

- **GIVEN** a promotion whose command carries no per-channel outcome, or an outcome that names fewer channels than were scheduled
- **WHEN** it executes
- **THEN** it returns an error `Result` and writes nothing; it does not treat the missing information as success, and it does not record a partial it cannot substantiate

#### Scenario: an empty scheduled set is refused [unit]

- **GIVEN** a promotion whose outcome names zero scheduled channels
- **WHEN** it executes
- **THEN** it returns an error `Result` — a vacuous total is not a publish

#### Scenario: a post with no publication record is refused [unit]

- **GIVEN** a promotion for a post persisted before this change, carrying no per-channel record
- **WHEN** it executes
- **THEN** it returns an error `Result` naming the missing record, and writes nothing

#### Scenario: the NOT_IMPLEMENTED seam is gone [static]

- **GIVEN** the change is applied
- **WHEN** the promotion use case is inspected
- **THEN** it contains no refusal of a non-total outcome deferring to a later change, and the partial path writes records

#### Scenario: the outcome is observable at the moment it is built [static]

- **GIVEN** the change is applied
- **WHEN** the saga's scheduling step and the promotion command it later emits are inspected
- **THEN** the channel identities the step enqueued are recorded and reach the command, so the outcome is decided from the channels actually scheduled rather than from a count

---

### Requirement: Re-application is idempotent — per post AND per channel **[MERGE-BLOCKING]**

(Previously: idempotency was stated for the post only — a re-application finding the post already
`PUBLISHED` returns success without a second event. It now also holds PER CHANNEL, because a
retryable step and a redelivered worker completion can re-present one channel's outcome
independently of the post's.)

The promotion is invoked from a RETRYABLE saga step: the engine may execute it again after a
partial failure, a duplicate completion event, or a process restart. A re-application that finds
the post already `PUBLISHED` SHALL return a success `Result`.

It SHALL NOT emit a second `PostPublished`, SHALL NOT write a second outbox row, and SHALL NOT
change the existing `publishedAt` — the first promotion's timestamp is the publication's record and
is immutable thereafter.

**Per channel, the same holds.** Re-presenting an outcome for a channel whose record already reads
PUBLISHED SHALL return success and SHALL NOT overwrite that record's external reference or
publication moment, SHALL NOT increment its attempt count, and SHALL NOT emit a second per-channel
event. Re-presenting the SAME failure for an unresolved channel SHALL be recorded once, so a
redelivered failure event does not consume two attempts of the channel's budget.

A re-application SHALL NOT surface the state machine's refusal of a transition out of the terminal
state as an error: a saga whose post is already published MUST NOT fail on retry. The evidence
SHALL present a DISTINCT timestamp on the second attempt, because an assertion over two identical
values cannot distinguish "preserved" from "overwritten with the same value".

#### Scenario: the promotion executed twice publishes once [integration]

- **GIVEN** a post promoted by a successful publish-now
- **WHEN** the promotion is executed a second time for the same post
- **THEN** it returns success, the row still reads `PUBLISHED` with the ORIGINAL `publishedAt`, and exactly one `PostPublished` row exists in the outbox

#### Scenario: a re-presented channel success preserves the original record [unit]

- **GIVEN** a channel whose record already reads published, and a second completion carrying a DISTINCT identifier and timestamp
- **WHEN** it is applied
- **THEN** it returns success, the record keeps its original identifier and publication moment, and the attempt count is unchanged

#### Scenario: a redelivered channel failure consumes one attempt, not two [unit]

- **GIVEN** an unresolved channel whose transient failure event is delivered twice
- **WHEN** both are applied
- **THEN** the attempt count advanced by one and the channel's budget was charged once

#### Scenario: a retry after the promotion committed does not fail the saga [integration]

- **GIVEN** a publish-now saga whose promotion committed and whose step is re-entered by a redelivered completion event
- **WHEN** the saga runs to a terminal state
- **THEN** it reaches COMPLETED, and it does not reach FAILED

#### Scenario: the terminal state is answered, not rejected [unit]

- **GIVEN** a post already in `PUBLISHED`
- **WHEN** the promotion executes with a valid total-success outcome
- **THEN** it returns success and dispatches no domain event; no invalid-transition error reaches the caller

---

## RENAMED Requirements

Two of the three requirements above change their HEADING as well as their body, because the heading
stated the behaviour that this change replaces. Both are declared here so the archive matches the
old block, renames it, and then applies the MODIFIED body written above under the new name. R1's
heading is unchanged.

### Requirement: The command carries the publish outcome, and anything short of total success is REFUSED → The command carries the publish outcome, and a NON-TOTAL outcome is RECORDED

(Reason: the heading asserted the refusal that this change deletes. A heading that still says
"REFUSED" beside a body that records would be the most misleading line in the capability.)
(Migration: consumers referring to this requirement by name — `CompletePostPublishingUseCase`'s
`NOT_IMPLEMENTED` message, the design and task artifacts of N-COR-1, and the suites that assert the
refusal — update to the new name; the refusal of an UNKNOWABLE outcome survives under the new name
and its tests stay valid.)

### Requirement: Re-application is idempotent — an already-PUBLISHED post succeeds without a second event → Re-application is idempotent — per post AND per channel

(Reason: the guarantee now covers a second axis the old heading did not name — one channel's
outcome re-presented independently of the post's.)
(Migration: none for existing consumers; the post-level guarantee and its scenarios are unchanged,
and the per-channel clause is additive.)
