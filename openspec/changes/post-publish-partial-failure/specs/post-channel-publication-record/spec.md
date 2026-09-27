# Post Channel Publication Record — Spec (post-publish-partial-failure, Slice 1)

> **NEW capability** for change `post-publish-partial-failure` (N-COR-8). Capability: **a post's
> intended channels and what happened on each of them are a DURABLE record inside the `Post`
> aggregate boundary; the post's publication status is a pure function of that record; a publish
> that reaches some channels and not others forward-completes, locks its content, and stays
> retryable.**
>
> **Why the record is the whole subject.** The intended target set is never persisted today:
> `SchedulePostUseCase` validates every channel then echoes `channelIds` in a DTO (`:139-151`,
> `:194-199`), `PostAggregate` has no channel collection (`:53-65`), `model Post` has no channel
> relation (`schema.prisma:697-776`), and `markAsPublished(providerResults)` feeds an event payload
> and nothing else (`PostAggregate.ts:399-421`). So when two channels publish and one fails, the wait
> step reads job COUNTS (`saga.ts:796-834` @`6737984a`; `failed > 0` at `:926-933` in the working
> tree), returns `failed`, the engine exhausts its retries and calls `failSaga` with no compensation
> past the pivot, and the row stays `DRAFT` with a null `publishedAt` while two providers hold live
> content. Every requirement below asserts the PERSISTED record and what readers derive from it.
>
> **Decisions already signed (Edward, 2026-09-16 — `pre-propose-decisions.md`), not re-litigated:**
> published requires EVERY intended channel (Q1); the customer sees per-channel outcome and retries
> the missing channels, a channel with a problem of its own is EXCLUDED and the post reads "Partially
> Posted" (Q2); content LOCKS at the first publish (Q3); the per-channel record inside the `Post`
> boundary is the source of truth, the post status DERIVED (Q4); webhook rollups are N-COR-9 (Q5);
> `PARTIALLY_PUBLISHED` RESTS (Q7); an excluded channel is re-includable, publishing the SAME locked
> content (Q8); the lock is IMMEDIATE — strong boundary, contention accepted (Q9); a published record
> carries the content fingerprint (Q10); threads are ALL-OR-NOTHING per channel (Q11–Q14, below).
>
> **Left OPEN for design.** The record's entity/model name; the attempt-budget number and backoff and
> where the transient retry executes; whether the derived status is computed at read or materialized;
> `PublishLog`'s fate (promote / shadow / retire); whether the registered per-channel event vocabulary
> gets its first producer here; whether `PublishStatus`'s FSM stays the mechanism behind editability
> and re-drive admission. Every requirement is satisfiable by ANY of those; where one constrains the
> fork, it says so in its own text.
>
> **Scenario tags.** `[integration]` — real Postgres row, outbox and wired saga; only a real row
> decides atomicity, isolation and derivation. `[unit]` — vitest with doubles of the ports, never of
> the unit under test. `[static]` — decidable by inspecting source or a gate's measured count.
>
> **Line pins.** `saga.ts`, `cqrs.ts` and `PostCommandHandlers.ts` citations are the explore's pins at
> `6737984a` (those three carry N-COR-1 PR3 and have drifted; the drifted line is given where it
> matters). Every other citation was spot-checked against the tree on 2026-09-16.

---

## Amendment 2026-09-17 (Q15–Q18)

Edward signed Q15–Q18 (`pre-propose-decisions.md` §"Third design gate follow-ups (rev 3, signed
2026-09-16)"). ONE requirement changed here — **LIVE FRAGMENTS PENDING RETRACTION**: its "never by a
timeout" clause splits in two, because the application's action window (Q16) and the truth about live
content (Q17) are different things. The window finalizes the channel's OUTCOME and ends the alert
cycle (`post-publication-retraction-alert`); the live fragments, the live-content predicate and the
content lock survive it, cleared only by the explicit act whose delivery window Q15 fixes
(`post-channel-publication-retry`).

---

## Amendment 2026-09-16 (Q11–Q14)

The design gate found a spec gap on MULTI-FRAGMENT posts (threads). Edward signed Q11–Q14
(`pre-propose-decisions.md` §"Design-gate follow-up (rev 2, C-new-1)"). What changed in this file:

1. **NEW** requirement — a channel's outcome is ALL-OR-NOTHING across the post's fragments, and every
   fragment reference survives an interrupted thread (Q11).
2. **NEW** requirement — live fragments pending retraction are an EXPLICIT, named state (Q12/Q13).
3. The content lock is now decided by an explicit **live content** predicate — a published record OR
   a not-published record with fragments pending retraction — not by "published" alone.
4. The derivation is restated in Edward's literal terms (Q11 + D15.1), with `FAILED` covering a post
   whose fragments are still live pending retraction.
5. The `PARTIALLY_PUBLISHED` resting-state requirement says out loud that NO channel is ever
   permanently closed, and names the exit for a stranded thread.
6. The re-drive requirement refuses a channel that still has live fragments.

### Dependency — N-COR-10 "thread atomicity: retraction" is ASSUMED (Q12)

Retracting published fragments is a SEPARATE change. No provider port exposes delete/unpublish today
(`packages/ports/src/ProviderAdapter.ts:108-160` has no delete member; only three api clients carry an
internal one — `providers/x/src/apiClient.ts:326`, `providers/telegram/src/apiClient.ts:555`,
`providers/youtube/src/apiClient.ts:271`; the other eight providers have none). **N-COR-10** owns the
retraction port, its per-provider adapters, the per-provider capability table and the compensating
worker step. N-COR-8 specifies the OUTCOME contract only — what the record must hold and what the
readers must derive — never the retraction mechanism. **Until N-COR-10 lands, retraction is MANUAL**,
and the customer's signal is the urgent alert specified in `post-publication-retraction-alert`.

---

## Requirements

### Requirement: The intended target set is RECORDED when the post is scheduled **[MERGE-BLOCKING]**

Scheduling a post SHALL persist one publication record per intended channel, durable independently
of the saga row that scheduled it. The record set SHALL be the system's answer to "where was this
post meant to go", readable without the saga, without the queue, and without `PublishLog`.

Today the one place that knows the targets throws them away: `SchedulePostUseCase.ts:139-151`
validates each channel exists and `:194-199` returns `channelIds` in the output DTO without
persisting them, and the only durable copy is the saga row's `stepData`. An INTENT that lives only
in the coordinator's scratch space cannot answer "which channel is missing" after the coordinator
ends.

A channel whose job never ran, was evicted, or never reported SHALL still have a record — in an
unresolved outcome. **Absence of a record SHALL NEVER be the representation of an outcome.**

#### Scenario: scheduling persists one record per intended channel [integration]

- **GIVEN** a post scheduled to three channels
- **WHEN** the schedule command commits
- **THEN** reading the records back yields exactly three, one per intended `channelId`, each in an unresolved outcome

#### Scenario: the target set outlives the saga [integration]

- **GIVEN** a publish-now saga that has reached a terminal state
- **WHEN** the post's records are read without consulting the saga row
- **THEN** the intended channel set and every per-channel outcome are answerable in full

#### Scenario: a channel that never ran is recorded, not missing [integration]

- **GIVEN** a publish in which one channel's job never executed
- **WHEN** the records are read
- **THEN** that channel has a record in an unresolved outcome, and no consumer infers its state from the absence of a row

#### Scenario: the schedule path no longer discards the target set [static]

- **GIVEN** the change is applied
- **WHEN** the scheduling use case is inspected
- **THEN** the validated channel identities are persisted through the aggregate, not only returned in the output DTO

---

### Requirement: One record per (post, channel), written ONLY through the aggregate root **[MERGE-BLOCKING]**

There SHALL be at most ONE publication record per `(post, channel)` pair, keyed by the channel's
identity. The channel SHALL be referenced BY IDENTITY only — the record holds a channel id, never a
`Channel` object — and the provider SHALL be DERIVED from the channel, never stored beside it as an
independent targeting dimension (ADR-0016: the channel is the canonical targeting unit; the change
that deleted `PublishingQueue.results` deleted exactly that duplication).

Every mutation of a record SHALL pass through the `Post` aggregate root. No worker, webhook
processor, route handler, repository caller, or query path SHALL write a record directly. The
worker's per-channel outcome therefore reaches the record through a root-mediated command resolved
from the workers' own composition root, replacing today's direct `PublishLog` upsert
(`publishHandler.ts:379-388`, `:331-344`) as the write of publication truth.

The root is where the set-level invariants live — the content lock and the derived status are both
predicates over the whole record set — so a direct child write is not a shortcut, it is a write that
cannot enforce them.

#### Scenario: a second record for the same channel is impossible [integration]

- **GIVEN** a post with a record for a channel
- **WHEN** a second outcome arrives for that same channel
- **THEN** the existing record is updated and no second record exists for that `(post, channel)` pair

#### Scenario: a direct child write is refused [integration]

- **GIVEN** an attempt to persist a publication record outside the aggregate root
- **THEN** it does not produce a persisted record — the write path does not exist, or it is refused

#### Scenario: no production writer bypasses the root [static]

- **GIVEN** the change is applied
- **WHEN** production source is searched for writers of the record
- **THEN** every one of them goes through the aggregate root, and the worker's outcome write is a root-mediated command resolved from the workers' composition root

#### Scenario: the record keys by channel and derives the provider [static]

- **GIVEN** the change is applied
- **WHEN** the record's shape is inspected
- **THEN** it carries a channel identity and no independently-chosen provider field, and no results blob keyed by provider name is reintroduced on the post

---

### Requirement: Each record carries an OUTCOME, a REASON and an ATTEMPT count **[MERGE-BLOCKING]**

Each record SHALL carry exactly one outcome from a closed set:

| Outcome    | Meaning                                                           | Carries                                                                               |
| ---------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| unresolved | not yet attempted, in flight, or failed transiently within budget | the last failure cause, when there was one                                            |
| published  | the provider accepted the content                                 | the provider's external reference for the published item, and the moment it published |
| excluded   | this channel will not be attempted again without an explicit act  | a reason naming the cause in terms the customer can act on                            |

A published outcome SHALL carry the provider's external reference. When a provider returns none, the
record SHALL say so EXPLICITLY rather than storing an empty, null-as-unknown, or fabricated value —
"the provider gave no id" and "we never asked" must not share a representation.

An excluded outcome SHALL carry a reason. "Excluded" with no reason is the failure this change
exists to delete, restated one level down.

`excluded` is the record's word for the terminal not-published outcome; **the customer reads that
channel as FAILED** (Q11's vocabulary). The two words name ONE state — the record's closed set is not
widened by the customer-facing rendering, and no third terminal outcome exists.

A record SHALL additionally be able to carry the set of FRAGMENT references that are live on the
provider for that channel (see "all-or-nothing across fragments" below). For a published outcome that
set is the whole post; for a not-published outcome it is empty once nothing is live, or the fragments
still awaiting retraction.

The attempt count SHALL be monotonic per record: it counts every attempt made for that channel and
is never reset by a re-inclusion or a re-drive, so the history of a stubborn channel is readable
after it finally publishes.

#### Scenario: a publish records the provider reference [integration]

- **GIVEN** a channel whose provider accepted the content and returned an identifier
- **WHEN** the record is read back
- **THEN** its outcome is published and it carries that identifier and the publication moment

#### Scenario: a provider that returns no identifier is recorded as such [unit]

- **GIVEN** a successful publish from a provider that returns no external identifier
- **WHEN** the record is read back
- **THEN** the outcome is published and the absence of an identifier is explicit, distinguishable from a channel that was never attempted

#### Scenario: an exclusion always carries its reason [integration]

- **GIVEN** a channel excluded for a problem of its own
- **WHEN** the record is read back
- **THEN** its outcome is excluded and it carries a reason naming the cause

#### Scenario: attempts accumulate across re-drives [unit]

- **GIVEN** a channel attempted twice, excluded, re-included and attempted again
- **WHEN** the record is read back
- **THEN** the attempt count reflects every attempt and was not reset by the re-inclusion

---

### Requirement: A channel's outcome is ALL-OR-NOTHING across the post's FRAGMENTS **[MERGE-BLOCKING]**

A post MAY carry several fragments (a thread). A channel's outcome SHALL be `published` ONLY when
EVERY fragment of that post went out on that channel. **A partially published channel SHALL NOT be a
persistable outcome** (Q11) — there is no committed state in which a channel holds some fragments and
reads as published, and none in which it holds some fragments and reads as an ordinary clean failure.

When any fragment is missing after the channel's attempt budget, the fragments that DID go out SHALL
be RETRACTED from the platform and the channel SHALL resolve to the terminal not-published outcome
with a reason naming the interrupted thread. **The retraction mechanism is N-COR-10's** (see the
Dependency above); what is fixed here is the outcome contract the mechanism must satisfy.

**Every fragment that went out SHALL be recorded with its provider reference, on EVERY path —
including the interrupted one.** Today they are LOST: `XAdapter.publishThread` accumulates each
fragment's id in `publishedTweets` (`packages/providers/x/src/XAdapter.ts:315-317`, `:336-341`) and
then returns `err("THREAD_INTERRUPTED")` (`:363-371`), discarding them, while the worker's failure
path logs only the error (`apps/workers/src/publishHandler.ts:574-590`). Retraction has nothing to
address and the customer nothing to act on unless those references are persisted, so this clause is
the precondition of BOTH Q12's retraction and Q13's alert. Six providers implement the optional
`publishThread` (`packages/ports/src/ProviderAdapter.ts:152-155`), so this is not X-specific.

A re-send of a thread SHALL NOT double-post: because nothing is live on a channel that resolved
not-published once retraction completed, the whole thread can be re-sent intact (Q8 preserved).

#### Scenario: a single-channel thread with 1 of 3 fragments live resolves FAILED [integration]

- **GIVEN** a single-channel post of three fragments whose first fragment published and whose second fails past the channel's budget
- **WHEN** the outcome is recorded
- **THEN** the channel resolves to the terminal not-published outcome, the post derives the failure vocabulary (never `PARTIALLY_PUBLISHED`), and the live fragment is retracted — or, if retraction is unavailable, recorded as pending retraction

#### Scenario: a channel is never persisted as published with fragments missing [unit]

- **GIVEN** a channel on which some but not all of the post's fragments went out
- **WHEN** the outcome is recorded
- **THEN** no committed record for that channel carries a published outcome, whatever the order the fragment results arrived in

#### Scenario: an interrupted thread keeps every live fragment reference [unit]

- **GIVEN** a thread publish that fails after two of four fragments are live on the provider
- **WHEN** the record is read back
- **THEN** it carries the provider reference of BOTH live fragments, distinguishable from a channel on which nothing went out

#### Scenario: three of four channels complete and one fails — the post is PARTIALLY_PUBLISHED [integration]

- **GIVEN** a four-channel post (single-fragment or thread) in which three channels publish every fragment and the fourth resolves not-published
- **WHEN** the post is read back
- **THEN** it derives `PARTIALLY_PUBLISHED`, and each channel reads as either fully published or failed — never partially published

#### Scenario: a fully published thread on one of two channels is PARTIALLY_PUBLISHED [integration]

- **GIVEN** a two-channel thread in which every fragment went out on one channel and none on the other
- **WHEN** the post is read back
- **THEN** it derives `PARTIALLY_PUBLISHED` and the completed channel reads published with every fragment reference

---

### Requirement: LIVE FRAGMENTS PENDING RETRACTION are an explicit, named state **[MERGE-BLOCKING]**

When retraction is IMPOSSIBLE (the provider exposes no delete capability) or FAILS after its own
budget, the channel SHALL read as the terminal not-published outcome with a reason that NAMES the
live fragments and their provider references — "retraction pending" (Q13). It SHALL be readable as a
state, not inferred from a message: "failed with nothing live" and "failed with content still live on
the platform" SHALL NOT share a representation, because only the second one obliges the customer to
act and only the second one keeps the content locked.

While a channel has fragments pending retraction:

- the post's content stays LOCKED (the live-content predicate below) — live content is never editable
  (Q3), wherever it is live and whatever the post's status word says;
- that channel SHALL NOT be re-driven or retried; a re-send would double-post the live fragments. It
  becomes re-drivable ONLY once nothing is live there — retracted by N-COR-10, or removed manually by
  the customer and recorded as such;
- the customer SHALL be alerted urgently (`post-publication-retraction-alert`), because a manual
  retraction is the only exit while N-COR-10 is not in the tree.

Clearing the LIVE FRAGMENTS SHALL be an explicit act with a recorded cause (retraction succeeded, or
the customer declared the fragments removed). They SHALL NOT be cleared by a retry or by assuming
success.

**The application's action window FIXES the OUTCOME; it never clears the live content** (Q16/Q17).
When the customer's window to act expires (`post-publication-retraction-alert` owns the window and
ends the alert cycle), the channel's outcome SHALL be finalized as the terminal not-published one —
but the record SHALL keep every live fragment reference, the live-content predicate SHALL stay true,
and the content lock SHALL stay engaged until an explicit act clears them. A timeout that cleared the
state would assert that nothing is live on the platform, which elapsed time cannot know.

#### Scenario: an unretractable fragment set is named, not summarised [integration]

- **GIVEN** an interrupted thread on a provider with no delete capability
- **WHEN** the channel resolves
- **THEN** its outcome is the terminal not-published one, its reason names the live fragments with their provider references, and the state is distinguishable from a failure in which nothing went out

#### Scenario: a channel with live fragments refuses a retry [unit]

- **GIVEN** a channel whose record shows fragments pending retraction
- **WHEN** a retry or re-drive is requested for it
- **THEN** it is refused with a reason naming the live fragments, and no provider call is made

#### Scenario: the channel is re-drivable once nothing is live [integration]

- **GIVEN** a channel whose live fragments have been retracted or recorded as manually removed
- **WHEN** the channel is retried
- **THEN** it is admitted, the whole thread is re-sent, and on success every fragment reference is recorded

#### Scenario: live fragments are never cleared implicitly [unit]

- **GIVEN** a channel with fragments pending retraction
- **WHEN** time passes — including past the action window — the post is read, or another channel resolves
- **THEN** the live fragment references persist unchanged until an explicit act with a recorded cause clears them

#### Scenario: the expired action window finalizes the outcome without clearing the fragments [integration]

- **GIVEN** a channel with fragments pending retraction whose customer action window has expired
- **WHEN** the record is read back
- **THEN** its outcome is finalized not-published with the expiry as its recorded cause, every live fragment reference is still held, and the post's live-content predicate is still true

---

### Requirement: Content LOCKS the moment the post has LIVE CONTENT anywhere, with NO window **[MERGE-BLOCKING]**

From the instant the transaction that first gives the post LIVE CONTENT commits, every content write
for that post SHALL be refused. The lock SHALL be IMMEDIATE — there SHALL be no interval, however
brief, in which content already live on a provider is editable (Q9).

**The live-content predicate SHALL be explicit and SHALL be the ONLY input to the lock:**

> A post has **live content** when any of its channels holds a `published` record **OR** a
> not-published record with fragments pending retraction.

The word and the lock are therefore decided from the SAME truth but not from the same clause: the
post's status word is derived from COMPLETE publications (a channel counts only when every fragment
went out), while the lock is engaged by ANYTHING live — including fragments of a channel that reads
as failed. A `FAILED` post with live fragments is NOT editable (Q11 + Q13).

The refusal SHALL be decided from the RECORD, never from the post's status word. Today it is decided
from the word, and the word is wrong: a partially published post stays `DRAFT`, and
`PublishStatus.isEditable()` (`PublishStatus.ts:181-183`) is true for both `DRAFT` and `FAILED`, so a
user can rewrite copy that is already live on two providers and re-publish it.

The lock SHALL hold on EVERY content-write path, not only the one the customer UI uses. The paths
SHALL be enumerated and each SHALL be shown to refuse; a lock with one unguarded door is not a lock.

A post with NO live content anywhere remains editable — the lock is a consequence of publication, not
of scheduling.

#### Scenario: a content update after the first publish is refused [integration]

- **GIVEN** a post whose first channel has published while others are still unresolved
- **WHEN** a content update is attempted
- **THEN** it is refused, and reading the row back shows the content unchanged

#### Scenario: the lock and the first publish are the same commit [integration]

- **GIVEN** the transaction that records the first published outcome
- **WHEN** committed state is examined
- **THEN** no committed state exists in which a channel is published and the post's content is still writable

#### Scenario: an unpublished post with nothing live is still editable [unit]

- **GIVEN** a post whose records are all unresolved or excluded, with none published and no fragments pending retraction
- **WHEN** a content update is attempted
- **THEN** it succeeds

#### Scenario: a FAILED post with live fragments is NOT editable [unit]

- **GIVEN** a post whose only channel resolved not-published with fragments pending retraction, so its derived status is the failure vocabulary
- **WHEN** a content update is attempted
- **THEN** it is refused, because the lock reads the live-content predicate and not the status word

#### Scenario: every content-write path refuses [static]

- **GIVEN** the change is applied
- **WHEN** the content-write paths for a post are enumerated in production source
- **THEN** each consults the record and refuses once any channel has published, and none decides editability from the status word alone

---

### Requirement: Post-level publication status is a PURE FUNCTION of the record **[MERGE-BLOCKING]**

The post's publication status SHALL be DERIVED from the record set, by a derivation that is TOTAL
(every combination maps to exactly one value) and ORDER-INDEPENDENT (channel outcomes arrive in
arbitrary order and the result does not depend on that order). A channel counts as published ONLY
when EVERY fragment of the post went out on it (Q11); "fully published channel" below means exactly
that, and it is the only unit the derivation reads:

| Record set                                                           | Derived status                                                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| EVERY selected channel fully `PUBLISHED`                             | `PUBLISHED`                                                                                     |
| any intended channel unresolved                                      | in progress                                                                                     |
| none unresolved, ≥1 channel fully `PUBLISHED` and ≥1 failed/excluded | `PARTIALLY_PUBLISHED`, rendered to the customer as "Partially Posted"                           |
| none unresolved, NO channel fully published                          | `FAILED` — the existing failure vocabulary, **regardless of live fragments pending retraction** |

Stated the other way round, in Edward's literal terms (Q11 + D15.1): `PUBLISHED` = every selected
channel `PUBLISHED`; `PARTIALLY_PUBLISHED` = at least one channel fully `PUBLISHED` and at least one
failed or excluded; `FAILED` = no channel fully published. **"Partially Posted" requires at least one
FULLY published channel** — a post whose only channel got one fragment of three out is `FAILED`,
never partial, and the live fragment changes the LOCK (it stays engaged) but never the WORD.

`publishedAt` SHALL be set only when the derivation reaches `PUBLISHED`, and SHALL be immutable
thereafter (Q1; `post-publish-status-promotion` R1). A partially published post SHALL carry a null
`publishedAt`.

**There SHALL be exactly one answer, and every reader SHALL see it** — the re-publish guard
(`SagaIntegration.ts:428-432`), the editability decision (`PublishStatus.ts:181-183`), the dashboard
tile (`dashboard/page.tsx:62`) and top-performers (`PrismaPostQueryRepository.ts:339-352`) included.

**This requirement constrains the exposure fork without deciding it.** Whether the value is computed
at read or maintained as a materialized projection is design's call; either way, **divergence
between the record and the status SHALL NOT be representable**: a materialized value SHALL be
recomputed inside the SAME transaction as every record write and SHALL NOT be writable independently
of the record. A writer that can set the status without touching the record reintroduces exactly the
rollup-over-data-nobody-owns that ADR-0016 deleted.

#### Scenario: every channel published derives PUBLISHED [integration]

- **GIVEN** a three-channel publish in which all three channels publish
- **WHEN** the post is read back
- **THEN** its status derives `PUBLISHED`, `publishedAt` is non-null, and the existing total-success proof stays green

#### Scenario: two published and one excluded derives PARTIALLY_PUBLISHED [integration]

- **GIVEN** a three-channel publish in which two channels publish and one is excluded
- **WHEN** the post is read back
- **THEN** its status derives `PARTIALLY_PUBLISHED`, `publishedAt` is null, and the customer-facing rendering reads "Partially Posted"

#### Scenario: any unresolved channel keeps the post in progress [integration]

- **GIVEN** a publish with one channel published and one still unresolved
- **WHEN** the post is read back
- **THEN** its status derives the in-progress value, not `PUBLISHED` and not `PARTIALLY_PUBLISHED`

#### Scenario: a post that published nowhere is not "partial" [unit]

- **GIVEN** a record set in which every channel is excluded and none published
- **WHEN** the status is derived
- **THEN** it is the failure vocabulary, not `PARTIALLY_PUBLISHED`

#### Scenario: live fragments pending retraction do not make a post "partial" [unit]

- **GIVEN** a record set whose only channel resolved not-published with fragments still live pending retraction
- **WHEN** the status is derived
- **THEN** it is `FAILED`, not `PARTIALLY_PUBLISHED`, and the content lock is nevertheless engaged

#### Scenario: the derivation is total and order-independent [unit]

- **GIVEN** the same multiset of channel outcomes applied in different orders, and every combination of the outcome states
- **WHEN** the status is derived
- **THEN** each combination yields exactly one defined value, and permuting the arrival order changes nothing

#### Scenario: the status cannot diverge from the record [integration]

- **GIVEN** the change is applied
- **WHEN** the post's publication status is written or recomputed
- **THEN** it is produced from the record within the same transaction as the record write, and no production path can set it without a corresponding record

---

### Requirement: `PARTIALLY_PUBLISHED` is a RESTING state, not a terminal one **[MERGE-BLOCKING]**

A partially published post SHALL remain actionable: a later retry of its unpublished channels SHALL
be admissible and, on success, SHALL carry the post to `PUBLISHED` with `publishedAt` set at that
moment (Q7). It SHALL NOT be modelled as a dead end the way `PUBLISHED` is today
(`PublishStatus.ts:45`, terminal with zero outgoing edges).

Resting SHALL NOT weaken anything: while a post rests partially published, its content stays LOCKED,
its recorded target set SHALL NOT be silently replaced, and its already-published channels SHALL NOT
be re-attempted.

**NO channel is ever permanently closed** (Q8, unamended). A channel that resolved not-published —
including one whose thread was interrupted — SHALL remain re-includable once nothing is live on it.
There SHALL be no outcome from which a channel cannot return. The exit for a channel stranded with
live fragments is retraction (N-COR-10) or the customer's manual removal recorded as such; after
either, the channel is re-includable and the whole thread is re-sent intact. A `FAILED` post is
therefore not a dead end either — the same exit applies to it.

#### Scenario: a partially published post can still reach PUBLISHED [integration]

- **GIVEN** a post resting at `PARTIALLY_PUBLISHED` whose excluded channel has been remediated
- **WHEN** the missing channel is retried and publishes
- **THEN** the post derives `PUBLISHED` and `publishedAt` is set at that publication

#### Scenario: resting does not re-open the content [unit]

- **GIVEN** a post resting at `PARTIALLY_PUBLISHED`
- **WHEN** a content update is attempted
- **THEN** it is refused

#### Scenario: resting does not admit a new target set [unit]

- **GIVEN** a post resting at `PARTIALLY_PUBLISHED`
- **WHEN** a request presents a channel set different from the recorded one
- **THEN** the recorded target set is not silently replaced

---

### Requirement: The wait step reads the RECORD, and a failed channel is an OUTCOME, not a step failure **[MERGE-BLOCKING]**

The publish wait step SHALL decide from the per-channel record, never from queue counts:

- `waiting` while ANY intended channel is unresolved;
- `succeeded` once EVERY intended channel is published or excluded — including when some are
  excluded;
- `failed` reserved for observation failure (the record cannot be read) or scheduling data that was
  never recorded.

**A channel that ended in error SHALL NOT make the step `failed`.** That is today's defect: the step
computes `publishingComplete: status.failed === 0` and returns `outcome: "failed"` as soon as
`failed > 0` (`saga.ts:796-834` @`6737984a`; `:926-933` in the working tree), over counts from a
reader that cannot even name which channel failed (`QueuePort.ts:92`,
`queue-adapter.ts:214-238`).

Consequently a publish with a non-total outcome SHALL forward-complete: the saga SHALL reach
`COMPLETED`, never `FAILED`, once every channel has resolved. Past the pivot there is no compensation
(enforced, `SagaManagerExecution.ts:1085-1087`) and canon requires completion, not abandonment. The
customer's client treats `FAILED` as a thrown exception (`sagaClient.ts` — `SAGA_TERMINAL_STATUSES`,
`runSagaAndAwaitTerminal`), so today a partial publish surfaces to the customer as an error raised
over channels that DID publish.

The step SHALL NOT infer a channel's outcome from queue state. An evicted completed job reads as
absent to the queue (`queue-adapter.ts:219-223`); if that were read as failure it would produce a
SPURIOUS EXCLUSION of a channel that actually published.

#### Scenario: two published and one excluded completes the saga [integration]

- **GIVEN** a three-channel publish-now in which two channels publish and one fails nontransiently
- **WHEN** the saga runs to a terminal state
- **THEN** the wait step returns `succeeded`, the saga reaches `COMPLETED`, and it does not reach `FAILED`

#### Scenario: an unresolved channel is waiting, not failure [integration]

- **GIVEN** a publish with one channel still unresolved within its budget
- **WHEN** the wait step executes
- **THEN** it returns `waiting`, consumes no retry budget, and does not return `failed`

#### Scenario: an unreadable record is a step failure [unit]

- **GIVEN** a wait step whose record read fails
- **WHEN** it executes
- **THEN** it returns `failed` carrying the cause, and it does not report the publish as complete

#### Scenario: an evicted queue entry does not exclude a published channel [unit]

- **GIVEN** a channel the record shows published, whose queue job is no longer observable
- **WHEN** the wait step executes
- **THEN** that channel is treated as published, and no exclusion is recorded for it

#### Scenario: the customer is not handed an exception over channels that published [integration]

- **GIVEN** a partial publish driven through the customer's saga polling path
- **WHEN** it reaches a terminal state
- **THEN** the caller receives a terminal success carrying the per-channel truth, not a raised failure

---

### Requirement: A bounded per-channel attempt budget, with a transient / nontransient split **[MERGE-BLOCKING]**

Each record SHALL carry its own attempt budget, bounded and INDEPENDENT of its sibling channels: one
channel's failures SHALL NOT consume another channel's attempts, and SHALL NOT terminate the publish
for channels that are still progressing.

- A **transient** failure within budget SHALL leave the channel unresolved and retryable.
- **Budget exhausted** SHALL exclude the channel, with a reason naming exhaustion.
- A **nontransient** failure — a misconfiguration, a suspended account, or an equivalent problem of
  the channel's own — SHALL exclude the channel immediately, without spending the remaining budget
  on an attempt that cannot succeed.
- An **unclassifiable** failure SHALL neither exclude on a guess nor retry forever: it SHALL be
  treated as transient, bounded by the same budget, and then excluded with a reason that NAMES the
  uncertainty. Provider error classification is uneven across the eleven providers, so the classifier
  is allowed to say "I do not know" — it is not allowed to make that silent.

The saga SHALL reach a terminal state under every one of these paths. No channel may hold a saga open
indefinitely (canon: no infinite `RUNNING`).

#### Scenario: a transient failure within budget keeps the channel retryable [unit]

- **GIVEN** a channel whose attempt failed transiently with budget remaining
- **WHEN** the outcome is recorded
- **THEN** the record stays unresolved, the attempt count increases, and no exclusion is written

#### Scenario: budget exhaustion excludes with a reason naming it [unit]

- **GIVEN** a channel whose transient failures have consumed its budget
- **WHEN** the next outcome is recorded
- **THEN** the record becomes excluded and its reason names the exhausted budget

#### Scenario: a nontransient failure excludes immediately [unit]

- **GIVEN** a channel whose first attempt fails for a problem of its own
- **WHEN** the outcome is recorded
- **THEN** the record becomes excluded with that reason, and no further attempt is made for it

#### Scenario: an unclassifiable failure is bounded, then named [unit]

- **GIVEN** a channel whose failure cannot be classified as transient or nontransient
- **WHEN** it is retried to the budget and excluded
- **THEN** it was not excluded on the first attempt, and its exclusion reason names the uncertainty

#### Scenario: one stuck channel still terminalizes the saga [integration]

- **GIVEN** a publish in which one channel never resolves
- **WHEN** the saga's horizon passes
- **THEN** the saga reaches a terminal state under a reason naming the timeout, and the other channels' recorded outcomes are intact

---

### Requirement: The post, its records and the outbox commit ALL-OR-NOTHING **[MERGE-BLOCKING]**

A write that touches the post row, one or more publication records and the outbox SHALL commit in
ONE transaction. A failure at any point SHALL leave the post, every record and the outbox exactly as
they were.

This is a MULTI-statement save, which is the shape where a failure raised after the first statement
would otherwise be caught and returned as an error while the partial write commits. The save SHALL
therefore signal its abort through the `Result`-aware transaction seam (ADR-0023): an `err` rolls the
transaction back and is returned unchanged as a VALUE. No `throw` SHALL cross a layer boundary
(fitness #4), and the application core SHALL open no transaction of its own (fitness #40).

#### Scenario: a failure midway leaves nothing behind [integration]

- **GIVEN** a record-outcome write whose transaction fails after the post has been mutated in memory
- **WHEN** the row, the records and the outbox are read back
- **THEN** none of the three changed

#### Scenario: the outcome and its event share one transaction [integration]

- **GIVEN** a record-outcome write that emits a domain event
- **WHEN** committed state is examined
- **THEN** no committed state exists carrying the record change without its outbox row or the outbox row without the record change

#### Scenario: the save uses the Result-aware seam and opens no transaction of its own [static]

- **GIVEN** the change is applied
- **WHEN** the record-writing use cases and the repository are inspected
- **THEN** failure is signalled as an `err` through the `Result`-aware transaction seam, no `throw` crosses the core boundary, and no transaction is opened outside the sanctioned seam

---

### Requirement: A re-drive schedules ONLY the channels the record shows unpublished **[MERGE-BLOCKING]**

Re-driving the publish of a post that has unpublished intended channels SHALL be admitted, and SHALL
enqueue a job for EXACTLY those channels — zero jobs for channels already published.

Two guards refuse this today and both are re-specified against the record, not the status word:
`/start` admits only `status === "DRAFT"` (`SagaIntegration.ts:428-432`), and the pivot's reread
countermeasure aborts unless the post is `DRAFT` (`saga.ts:1103-1109` @`6737984a`; the predicate is
`:1106-1109` in the working tree, reason `Post.status is ${status}, expected DRAFT`). **The pivot's
reread precondition SHALL be evaluated PER CHANNEL** — "is THIS channel still unpublished" — so the
countermeasure keeps protecting against a stale read without refusing every re-drive of a partially
published post.

A re-drive of a post with NO unpublished channels SHALL be refused as a client error and SHALL
enqueue nothing — the duplicate-send guard (`post-publish-status-promotion` R7) is preserved, not
traded away.

The re-drive SHALL publish the SAME locked content that is already live on the published channels
(Q3, Q8). It SHALL NOT take a new target set from the caller.

A channel with fragments PENDING RETRACTION SHALL NOT be enqueued by a re-drive, with a reason naming
the live fragments: re-sending a thread whose earlier fragments are still live double-posts them, and
past the pivot there is no undo. Such a channel becomes enqueueable only once nothing is live on it.

Today the only re-drive is accidental: the worker's `dedupeKey` + `OK`-skip (`publishHandler.ts:726`,
`:733-739`) makes a whole-post re-drive channel-selective — a real property that is unowned,
undocumented, and emits no completion for the skipped channels (it returns before notifying the
saga), so the saga advances only on the 30 s poll. This requirement makes the property OWNED, and the
skip path SHALL read the record and emit the completion it swallows today.

#### Scenario: a re-drive enqueues exactly the missing channel and completes the post [integration]

- **GIVEN** a post with two published channels and one excluded channel that has been remediated
- **WHEN** the publish is re-driven
- **THEN** exactly ONE publish job is enqueued (for that channel) and, on its success, the post derives `PUBLISHED`, carries a non-null `publishedAt`, and exactly one `PostPublished` row exists in the outbox for that post

#### Scenario: a fully published post's re-drive is refused and enqueues nothing [integration]

- **GIVEN** a post whose every intended channel has published
- **WHEN** the publish is re-driven
- **THEN** the request is rejected as a client error and the queue receives no new publish job

#### Scenario: the pivot precondition is evaluated per channel [unit]

- **GIVEN** a pivot re-entered for a post that is partially published
- **WHEN** its reread countermeasure runs
- **THEN** it decides per channel from the record, admits the unpublished channels, and does not abort on the post's global status

#### Scenario: a published channel is never re-sent [integration]

- **GIVEN** a re-drive of a partially published post
- **WHEN** the worker processes the enqueued work
- **THEN** no provider call is made for a channel the record shows published, and that channel's recorded outcome, identifier and publication moment are unchanged

#### Scenario: a channel pending retraction is not enqueued [unit]

- **GIVEN** a re-drive of a post with one unresolved channel and one channel holding fragments pending retraction
- **WHEN** the channels to schedule are decided
- **THEN** only the unresolved channel is enqueued, and the refusal for the other names its live fragments

#### Scenario: the skip path reports what it skipped [integration]

- **GIVEN** a re-drive in which the worker skips a channel it has already published
- **WHEN** the saga advances
- **THEN** it advances on the skip's own notification rather than only on the next poll

---

### Requirement: The record is the SOLE source of publication truth, and its absence FAILS CLOSED **[MERGE-BLOCKING]**

After this change, no consumer of publication truth SHALL answer "did this post publish" or "did this
channel publish" from `PublishLog` (`schema.prisma:939-957`). Its fate — promoted, kept as a
worker/webhook receipt log, or retired — is decided in design and recorded in the owed ADR; what is
fixed HERE is that it is no longer consulted for truth. Two sources of publication truth is the
divergence this capability exists to prevent.

Posts and sagas persisted BEFORE this change carry no record. Every consumer SHALL FAIL CLOSED with a
NAMED reason: it SHALL NOT read the absence as "nothing published", SHALL NOT report a total success,
and SHALL NOT reconstruct a target set from the queue, from `PublishLog`, or from a default channel
selection. An outcome that cannot be established is not an outcome.

#### Scenario: a pre-existing post without a record refuses promotion [unit]

- **GIVEN** a post that predates this change and has no publication record
- **WHEN** its publication outcome is asked for
- **THEN** the answer is an error `Result` naming the missing record, and nothing is written

#### Scenario: a pre-existing saga does not report a false success [unit]

- **GIVEN** a saga persisted before this change whose post has no record
- **WHEN** its wait step executes
- **THEN** it does not report the publish as complete, and it names the missing record as the cause

#### Scenario: no publication-truth consumer reads PublishLog [static]

- **GIVEN** the change is applied
- **WHEN** production readers of publication truth are enumerated
- **THEN** none of them reads `PublishLog` to decide whether a post or a channel published

---

### Requirement: The record is tenant-isolated by construction **[MERGE-BLOCKING]**

The record model SHALL be enrolled in the tenant guard (`TENANT_SCOPED_MODELS`,
`tenantGuard.ts:91-…`) and SHALL satisfy the living `multi-tenant-isolation` enrollment obligations
for an `accountId`-bearing model — those invariants are REUSED here, not restated. On every persisted
row `accountId` SHALL equal the parent post's `accountId`.

Its row-security policy SHALL conform to `rls-policy-form` (the canonical InitPlan-wrapped predicate;
migrations timeout-bounded, reversible, and landing with their schema edit in one commit) — a
conformance constraint, not a modification of that capability.

Fitness #39 SHALL be satisfied at zero: an `accountId`-bearing model that is neither enrolled nor
documented on the denylist is cross-tenant by default, because the guard silently skips a model it
does not know. If the model carries `deletedAt`, its reads SHALL be SWEPT under fitness #38 and SHALL
NOT be quarantined (the quarantine floor may only shrink).

The per-channel create path's parent-ownership obligation is specified in this change's
`multi-tenant-isolation` delta.

#### Scenario: a cross-tenant read returns nothing [integration]

- **GIVEN** tenant A authenticated and tenant B owning a post with publication records
- **WHEN** A reads publication records scoped to its own account
- **THEN** none of B's records is reachable

#### Scenario: the row's account matches its post's [integration]

- **GIVEN** records persisted through the aggregate root
- **WHEN** the rows are read back
- **THEN** every row satisfies `accountId == post.accountId`

#### Scenario: the model is enrolled and row-secured [static]

- **GIVEN** the change is applied
- **WHEN** fitness #39 and the row-security coverage gate run
- **THEN** the model is enrolled in `TENANT_SCOPED_MODELS`, documented, and covered by a policy in the canonical form, with #39 measuring zero

#### Scenario: the unenrolled model is caught [static]

- **GIVEN** the model planted without its enrollment
- **WHEN** fitness #39 runs
- **THEN** it exits non-zero naming the model — the red path is demonstrated before the gate is trusted

### Requirement: A published record carries the CONTENT FINGERPRINT that was published

Signed at pre-propose Q10 (2026-09-16): identity — the deterministic per-(post, channel) key — stays
the retry guarantee; the fingerprint is AUDIT. When a channel outcome is recorded as published, the
record SHALL carry a content hash computed over the locked content as it was handed to the provider
(text and the ordered media identifiers), so that "what exactly went out, where" is answerable from
the record alone. The hash SHALL NOT participate in the retry decision, and a cross-post duplicate
guard built on it (same content, another post, same channel) is a separate slice with its own product
decisions (window, confirmation) — out of this change.

#### Scenario: a published outcome records the fingerprint of the locked content [unit]

- **GIVEN** a post whose content is locked and a channel outcome recorded as published
- **WHEN** the record is read back
- **THEN** it carries the content hash of the locked content, and two channels published from the same locked content carry the same hash

#### Scenario: the fingerprint never changes the retry decision [unit]

- **GIVEN** a re-drive of a post with one unpublished channel
- **WHEN** the channels to schedule are decided
- **THEN** the decision depends only on each record's outcome, never on the fingerprint

---

## Verification note (strict TDD — RED → GREEN)

Every **[MERGE-BLOCKING]** requirement is RED on the unmodified tree, and the dangerous reds fail by
REPORTING THE WRONG THING rather than by crashing: the partial-publish scenario fails today by
reaching saga `FAILED` with the row left `DRAFT`, and the lock scenario fails by ACCEPTING an edit to
content that is live on a provider. Both therefore assert the PERSISTED record, the PERSISTED row and
the outbox — never which command a double received.

The Q11–Q14 reds are the same class: the interrupted-thread scenario fails today by LOSING the live
fragment references (`XAdapter.ts:363-371` returns a bare `err`), so it asserts the persisted
references rather than the returned error, and the pending-retraction scenarios assert that a retry is
REFUSED and the content still LOCKED — a green that came from a crash would prove neither.

Integration scenarios need DB + Redis via `pnpm db:up`, run inside a real Unit of Work, and on LXC are
run heap-capped under a `timeout` wrapper. Every new suite is named by EXACTLY ONE `run_batch` in
`apps/api/scripts/run-tests.sh` (fitness #30 — a suite no batch names never executes while still
reading as coverage). New and changed code carries JSDoc `@file`/`@description`/`@layer` (fitness
#9/#10) and no phase or sprint reference (fitness #8). The schema edit and its migration land in ONE
commit.
