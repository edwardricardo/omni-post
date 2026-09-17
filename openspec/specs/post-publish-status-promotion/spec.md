# Post Publish Status Promotion — Delta Spec (post-publish-status-integrity)

> **NEW capability** for change `post-publish-status-integrity` (N-COR-1). Capability: **after a
> publish-now saga in which EVERY scheduled channel published, the Post aggregate reaches the
> persisted terminal state `PUBLISHED` with `publishedAt` set and `PostPublished` in the outbox —
> in ONE transaction, through the aggregate, exactly once, and never on an outcome that is not a
> total success.**
>
> **Why the persisted state is the whole subject.** The provider already has the post; today the
> database denies it. Every downstream consumer of truth — both re-publish guards, the status
> surfaces, analytics — reads a status that never advances, so the defect is not one wrong field:
> it is that the system's record of reality and reality disagree while the saga reports
> `COMPLETED`. Requirements below therefore assert the PERSISTED row and the outbox, never the
> shape of a command a double recorded.
>
> **Decisions already signed (Edward, 2026-09-14 — `pre-propose-decisions.md`), stated so they are
> not re-litigated:** the transition is a SYNCHRONOUS command from the saga step, with the event as
> an EFFECT in the same transaction (Q1); no schema migration (Q2); no backfill (Q3); the FSM is
> unchanged and the promotion is the two-hop `DRAFT → PUBLISHING → PUBLISHED` in one Unit of Work
> (Q4). No requirement below may be read as demanding an FSM amendment, a migration, or a repair
> script.
>
> **Non-goals.** Partial-failure POLICY — what status a post takes when N channels publish and M
> fail — is N-COR-2 with its own ADR; `markAsFailed()` stays unwired. The fail-closed REFUSAL of a
> non-total outcome is in scope; choosing a status for it is not. The phantom hardcoded version,
> the dropped `mediaIds`, and the `PublishPostCommandHandler` naming are backlog rows.
>
> **Scenario tags.** `[integration]` — requires a real Postgres row and outbox reached through the
> wired saga; only a real row decides atomicity. `[unit]` — vitest against the use case / step with
> doubles of the ports, never of the use case under test. `[static]` — decidable by inspecting
> source or a gate's measured count.

---

## ADDED Requirements

### Requirement: A total-success publish-now reaches PUBLISHED through the aggregate, in one transaction **[MERGE-BLOCKING]**

When every channel a publish-now saga scheduled has published, the post SHALL reach the persisted
state `PUBLISHED`, SHALL carry a non-null `publishedAt`, and SHALL have `PostPublished` recorded in
the outbox **in the same database transaction as the state mutation**.

The transition SHALL be performed by the aggregate's own promotion methods, in the order the state
machine requires (`DRAFT → PUBLISHING → PUBLISHED`), inside ONE Unit of Work. No field SHALL be
written directly on the repository, and the post SHALL be loaded and saved once within that
transaction.

The commit SHALL be all-or-nothing: a failure at any point leaves the post exactly as it was, with
no event in the outbox and no `publishedAt`. `PUBLISHING` SHALL NOT be observable as a durable
resting state of a successful promotion — it is an intermediate hop inside the transaction.

The promotion SHALL write no field other than the status, the publication timestamp, and the
aggregate's own bookkeeping: content present at load time SHALL be identical after the promotion.

#### Scenario: a publish-now whose channels all succeed lands PUBLISHED [integration]

- **GIVEN** a publish-now saga for a DRAFT post whose scheduled channels all report a successful publish
- **WHEN** the saga runs to a terminal state
- **THEN** reading the row back yields `status = PUBLISHED` and a non-null `publishedAt`, and the saga reports COMPLETED

#### Scenario: the event is in the outbox, written by the same transaction [integration]

- **GIVEN** the promotion above
- **WHEN** the outbox is read
- **THEN** exactly one `PostPublished` row exists for that post, and no committed state exists in which the status is PUBLISHED without it or the event exists without the status

#### Scenario: a failed commit leaves nothing behind [integration]

- **GIVEN** a promotion whose transaction fails after the aggregate has been mutated in memory
- **WHEN** the row and the outbox are read back
- **THEN** the status is unchanged, `publishedAt` is null, and no `PostPublished` row exists

#### Scenario: the transition goes through the aggregate, not through a field write [static]

- **GIVEN** the change is applied
- **WHEN** the promotion use case is inspected
- **THEN** it calls the aggregate's promotion methods for both hops, persists through the repository port inside one Unit of Work, and issues no direct status or timestamp write and no transaction of its own

#### Scenario: the previously dead promotion path is live [static]

- **GIVEN** the change is applied
- **WHEN** `startPublishing` and `markAsPublished` are searched across production source
- **THEN** each has at least one production caller

---

### Requirement: The publishing-started event's delivery is DECIDED, not discovered **[MERGE-BLOCKING]**

Wiring the first hop makes `PostPublishingStarted` reach the outbox for the first time, and that
event is not internal: it is registered as an integration event and mapped to the outbound
`post.publishing_started` delivery, so external subscribers begin receiving an event this system has
never emitted. Its timing is counterfactual — the hop runs AFTER the provider has already published
— so a subscriber would be told publishing started at a moment when it had already finished.

**The change SHALL make an explicit decision about that delivery and record it** (design document
and PR body): either the event is delivered and its meaning is restated for subscribers, or it is
kept internal to the aggregate's transition and not projected outward. What SHALL NOT happen is
silent activation of an outbound event as a side effect of wiring a state machine.

Whichever is decided, the invariant is the same: for a successful promotion a subscriber SHALL NEVER
observe `post.publishing_started` WITHOUT `post.published`, because both are effects of the one
transaction, and the started event SHALL NOT be presented anywhere as evidence that a publish is
currently in progress.

#### Scenario: the decision is recorded before the wiring ships [static]

- **GIVEN** the change is applied
- **WHEN** the design document and the PR body are inspected
- **THEN** each states whether `post.publishing_started` is delivered to external subscribers, and why, naming the counterfactual timing

#### Scenario: no subscriber sees a publish that started and never finished [integration]

- **GIVEN** a successful publish-now promotion
- **WHEN** the events committed by its transaction are read back
- **THEN** any `PostPublishingStarted` is committed by the same transaction as `PostPublished`, and no committed state exists carrying the first without the second

---

### Requirement: The command carries the publish outcome, and anything short of total success is REFUSED **[MERGE-BLOCKING]**

The status-transition command SHALL carry the publish OUTCOME: the set of channels the saga
scheduled, and for each one whether it published. A **total success** is every scheduled channel
reporting success; nothing else is.

A non-total outcome SHALL be refused with an error `Result`. The refusal SHALL write nothing: no
status change, no `publishedAt`, no event. A refused promotion SHALL NEVER return a success — the
silent success is the defect this capability exists to delete.

The refusal SHALL be FAIL-CLOSED over ignorance, not only over known failure: when the scheduled
channel set or the per-channel outcomes cannot be established, or the scheduled set is empty, the
promotion SHALL be refused. An outcome that cannot be shown to be total is not total.

**This is a seam, not a policy.** The refusal states only that this capability does not promote a
partial publish; which status a partially-published post should take is N-COR-2, and no requirement
here presumes an answer.

#### Scenario: one channel short of total is refused [unit]

- **GIVEN** a promotion whose outcome reports three scheduled channels, two successful and one not
- **WHEN** it executes
- **THEN** it returns an error `Result`, and the post's status, `publishedAt` and outbox are unchanged

#### Scenario: an unknowable outcome is refused, not assumed [unit]

- **GIVEN** a promotion whose command carries no per-channel outcome, or an outcome that names fewer channels than were scheduled
- **WHEN** it executes
- **THEN** it returns an error `Result` and writes nothing; it does not treat the missing information as success

#### Scenario: an empty scheduled set is refused [unit]

- **GIVEN** a promotion whose outcome names zero scheduled channels
- **WHEN** it executes
- **THEN** it returns an error `Result` — a vacuous total is not a publish

#### Scenario: the outcome is observable at the moment it is built [static]

- **GIVEN** the change is applied
- **WHEN** the saga's scheduling step and the promotion command it later emits are inspected
- **THEN** the channel identities the step enqueued are recorded and reach the command, so the outcome is decided from the channels actually scheduled rather than from a count

---

### Requirement: Re-application is idempotent — an already-PUBLISHED post succeeds without a second event **[MERGE-BLOCKING]**

The promotion is invoked from a RETRYABLE saga step: the engine may execute it again after a
partial failure, a duplicate completion event, or a process restart. A re-application that finds
the post already `PUBLISHED` SHALL return a success `Result`.

It SHALL NOT emit a second `PostPublished`, SHALL NOT write a second outbox row, and SHALL NOT
change the existing `publishedAt` — the first promotion's timestamp is the publication's record and
is immutable thereafter.

A re-application SHALL NOT surface the state machine's refusal of a transition out of the terminal
state as an error: a saga whose post is already published MUST NOT fail on retry. The evidence
SHALL present a DISTINCT timestamp on the second attempt, because an assertion over two identical
values cannot distinguish "preserved" from "overwritten with the same value".

#### Scenario: the promotion executed twice publishes once [integration]

- **GIVEN** a post promoted by a successful publish-now
- **WHEN** the promotion is executed a second time for the same post
- **THEN** it returns success, the row still reads `PUBLISHED` with the ORIGINAL `publishedAt`, and exactly one `PostPublished` row exists in the outbox

#### Scenario: a retry after the promotion committed does not fail the saga [integration]

- **GIVEN** a publish-now saga whose promotion committed and whose step is re-entered by a redelivered completion event
- **WHEN** the saga runs to a terminal state
- **THEN** it reaches COMPLETED, and it does not reach FAILED

#### Scenario: the terminal state is answered, not rejected [unit]

- **GIVEN** a post already in `PUBLISHED`
- **WHEN** the promotion executes with a valid total-success outcome
- **THEN** it returns success and dispatches no domain event; no invalid-transition error reaches the caller

---

### Requirement: The promotion honours the OCC token, and the idempotent answer is resolved FIRST **[MERGE-BLOCKING]**

When the command carries an `expectedVersion` and the persisted aggregate version has advanced past
it, the promotion SHALL return an error `Result` carrying the `CONFLICT` code and SHALL write
nothing. A concurrent writer's work is never overwritten by a promotion holding a stale token.

**The already-published check SHALL be resolved BEFORE the version comparison.** The promotion
itself advances the version, so a retry necessarily presents a token the promotion has already
outdated; ordering the comparison first would turn every retry of a SUCCESSFUL promotion into a
conflict and fail a saga that is in fact complete. Idempotency and OCC are not in tension only if
their order is stated, so it is stated here.

A `CONFLICT` SHALL be retryable by the caller: the saga step reports the attempt failed, and a
later attempt re-reads the aggregate and proceeds against the fresh version.

**The reused-draft path carries no token and SHALL NOT fabricate one.** When a publish-now saga
reuses an existing draft, no version was recorded at creation, so the command presents no
`expectedVersion`. In that case the persisted STATUS decides: the promotion SHALL be refused unless
the post is in a state from which the publish promotion is legal, so a post that has since been
cancelled, failed, or otherwise moved out of the publishable state is never promoted. The residual
is stated rather than engineered around here: without a token, a concurrent CONTENT edit committed
before the promotion's in-transaction load is preserved (the promotion re-reads and writes no
content), and detecting an edit that raced the promotion itself remains the repository guard's job.

#### Scenario: a stale token on a still-DRAFT post is a conflict [unit]

- **GIVEN** a DRAFT post whose persisted version has advanced past the `expectedVersion` the command carries
- **WHEN** the promotion executes
- **THEN** it returns an error `Result` with the `CONFLICT` code, and the status, `publishedAt` and outbox are unchanged

#### Scenario: a stale token on an already-PUBLISHED post is idempotent success, not a conflict [unit]

- **GIVEN** a post already promoted, and a re-application presenting the pre-promotion `expectedVersion`
- **WHEN** the promotion executes
- **THEN** it returns success, emits no event, and does not return `CONFLICT`

#### Scenario: a conflict is recoverable on the next attempt [unit]

- **GIVEN** a promotion refused with `CONFLICT`, followed by a second attempt after the concurrent write settled
- **WHEN** the second attempt executes
- **THEN** it re-reads the aggregate and promotes successfully, without the caller supplying a hand-computed version

#### Scenario: the tokenless reused-draft path refuses an unpublishable post [unit]

- **GIVEN** a reused-draft promotion presenting no `expectedVersion`, for a post whose persisted status is not one from which the publish promotion is legal
- **WHEN** it executes
- **THEN** it returns an error `Result` and writes nothing

---

### Requirement: The content-update command can no longer carry a status **[MERGE-BLOCKING]**

`UpdatePostCommandSchema` SHALL NOT declare `status`, and the content-update handler SHALL NOT
contain a branch that accepts and discards it. No code path reachable from the content-update
command SHALL be able to write `status` or `publishedAt`.

A command schema that advertises a field no consumer honours is what let a status transition be
routed into a content-only command and reported as success. Deleting the field makes that
mis-route a COMPILE ERROR for every in-repo producer, which is what "close the class" means here.

**The residual is named, not hidden:** schema validation strips unknown keys rather than rejecting
them, so removal is enforced by the type system for in-repo producers, not by a runtime refusal.
That is sufficient only because the saga step is the verified SOLE producer of `status` on this
command; the verification is part of the evidence, not an assumption.

#### Scenario: the field is gone from the schema [static]

- **GIVEN** the change is applied
- **WHEN** `UpdatePostCommandSchema` is inspected
- **THEN** it declares no `status` field, and the derived command type has no `status` property

#### Scenario: the warn-and-drop branch is gone [static]

- **GIVEN** the change is applied
- **WHEN** the content-update handler is inspected
- **THEN** no branch accepts, logs, or discards a `status`, and no call it makes can set a status or a publication timestamp

#### Scenario: no producer emits a status on the content-update command [static]

- **GIVEN** the change is applied
- **WHEN** production source is searched for producers of the content-update command
- **THEN** none supplies `status`, and the saga promotion step emits the dedicated transition command instead

---

### Requirement: The persisted terminal status makes the re-publish guards effective **[MERGE-BLOCKING]**

Both re-publish guards key off the persisted status, so once the promotion is correct they SHALL
trip. After a successful publish-now, a second attempt to start the publishing saga for the same
post SHALL be REJECTED as a client error, and **no additional publish job SHALL be enqueued** — the
harm this closes is a duplicate send to a provider, so the absence of new jobs is the assertion,
not the status code alone.

The publish command's already-published guard SHALL likewise refuse a post whose persisted status
is `PUBLISHED`.

#### Scenario: a second start is rejected and enqueues nothing [integration]

- **GIVEN** a post promoted by a successful publish-now
- **WHEN** the publishing saga is started again for that post
- **THEN** the request is rejected as a client error naming the post's non-DRAFT status, and the queue receives no new publish job

#### Scenario: the publish command refuses an already-published post [unit]

- **GIVEN** a post whose persisted status is `PUBLISHED`
- **WHEN** the publish command is handled for it
- **THEN** it is refused as already published

---

### Requirement: The promotion runs inside the saga's tenant scope, and refuses to run unscoped

The promotion executes from the saga engine, not from an HTTP request, so no ambient request tenant
exists. It SHALL execute bound to the tenant scope of the saga's account, so the row-level scope is
in force for the transaction that promotes the post.

It SHALL fail CLOSED: a promotion for which the tenant scope cannot be resolved SHALL be refused and
SHALL write nothing, rather than executing unscoped. This mirrors the scheduling step, which already
refuses to enqueue a job it cannot scope.

#### Scenario: the promoting transaction is tenant-scoped [integration]

- **GIVEN** a publish-now saga for an account
- **WHEN** the promotion commits
- **THEN** the write executed under that account's tenant scope, and no cross-tenant row was reachable by the transaction

#### Scenario: an unresolvable tenant scope refuses the promotion [unit]

- **GIVEN** a promotion whose saga context carries no resolvable account
- **WHEN** it executes
- **THEN** it returns an error `Result`, and no status, timestamp, or event is written

---

### Requirement: The saga step stays a thin emitter under the unchanged outcome contract

`UpdatePostStatusStep` SHALL forward the publish outcome and SHALL NOT choose a target status: the
`PUBLISHED`/`FAILED` computation it performs today is deleted, and the status is decided by the
aggregate through the promotion. The step remains a RETRYABLE step returning the existing
three-state outcome — `succeeded` when the promotion succeeds (including the idempotent answer),
`failed` when it is refused — so `saga-step-outcome-contract` is unchanged by this capability.

The emitted command id SHALL remain deterministic (`cmd-{sagaId}-{stepId}`), never a generated
identifier, so the bus and outbox dedupe as they do today.

Modes other than publish-now SHALL be untouched: for `draft` and `schedule` the step SHALL continue
to short-circuit, no promotion SHALL occur, and no `PostPublished` SHALL be emitted.

#### Scenario: the step no longer decides the status [static]

- **GIVEN** the change is applied
- **WHEN** the promotion step is inspected
- **THEN** it contains no target-status expression, and it emits the dedicated transition command carrying the outcome

#### Scenario: the command id is deterministic across attempts [unit]

- **GIVEN** the step executed twice for the same saga
- **WHEN** the emitted commands are compared
- **THEN** their ids are identical and derived from the saga and step identifiers

#### Scenario: a refused promotion is reported as a failed step [unit]

- **GIVEN** a promotion refused for a non-total outcome
- **WHEN** the step handles the result
- **THEN** it returns the `failed` outcome carrying the cause, and it does not report success

#### Scenario: a scheduled or draft saga promotes nothing [integration]

- **GIVEN** a saga run in `schedule` mode and one run in `draft` mode
- **WHEN** each reaches a terminal state
- **THEN** neither post is `PUBLISHED`, neither has a `publishedAt`, and no `PostPublished` row exists for them

---

### Requirement: The proof runs in CI, and the lock-in tests stop enshrining the defect **[MERGE-BLOCKING]**

The integration proof SHALL be named by EXACTLY ONE `run_batch` in `apps/api/scripts/run-tests.sh`.
A suite no batch names never executes while still reading as coverage, and a proof that never runs
is not a proof (fitness #30).

The existing tests that lock the defect in SHALL be rewritten, not deleted around: the unit test
asserting the fabricated version, the one documenting success-with-no-events for the saga's exact
no-op shape, and the deterministic-id test whose double returns success for a command the handler
drops. Each is green under the defect today; each SHALL fail on the unmodified tree after rewrite.

#### Scenario: the new suite is wired exactly once [static]

- **GIVEN** the change is applied
- **WHEN** `run-tests.sh` is inspected
- **THEN** the new integration suite appears in exactly one `run_batch`, and fitness #30's measured unreached count has not risen

#### Scenario: the merge-blocking scenarios are RED before the change [static]

- **GIVEN** the unmodified tree
- **WHEN** the promotion scenarios are run
- **THEN** they fail — the total-success scenario by finding `DRAFT` and a null `publishedAt` where `PUBLISHED` is required, and the guard scenario by accepting a second publish

#### Scenario: no rewritten test asserts a fabricated version [static]

- **GIVEN** the rewritten unit tests
- **WHEN** their assertions are inspected
- **THEN** none asserts a hardcoded aggregate version, and none documents a successful command that mutates nothing

---

## Verification note (strict TDD — RED → GREEN)

Every **[MERGE-BLOCKING]** requirement is RED on the unmodified tree. The dangerous red is the
total-success scenario: it fails by REPORTING SUCCESS — the saga reaches COMPLETED while the row
stays `DRAFT` — which is why every promotion scenario asserts the PERSISTED row and the OUTBOX
rather than which command a double received. The idempotency scenarios present distinct timestamps
so an overwrite is observable.

Integration scenarios need DB + Redis via `pnpm db:up`, run inside a real Unit of Work, and on LXC
are run heap-capped under a `timeout` wrapper. New and changed code carries JSDoc
`@file`/`@description`/`@layer` (fitness #9/#10) and no phase or sprint reference (fitness #8). No
edit to `infra/prisma/schema.prisma` or `infra/prisma/migrations/**` is permitted by any requirement
above (Q2).
