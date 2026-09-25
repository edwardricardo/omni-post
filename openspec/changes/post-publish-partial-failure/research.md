# Research: post-publish-partial-failure (N-COR-8)

**Lane**: external evidence for partial-publication modelling (comparable products, saga forward recovery with N independent external effects, aggregate boundary for a per-child record with derived parent status, status vocabulary precedent)
**Date**: 2026-09-16
**Selected by**: Edward (pre-propose, 2026-09-16) — this lane was explicitly selected, so completion is mandatory before `sdd-propose`.
**Provenance**: the sdd-research executor has no write tool; this file is the orchestrator's verbatim materialization of its final report (24 sources: 20 external, 4 internal readbacks). Internal claims [S23]/[S24] were spot-checked against the tree by the orchestrator.

**Evidence rules applied.** Every claim below carries a source number or is labelled `inferred`. Where a vendor help center refused a direct fetch (HTTP 401/403), the row is labelled `secondary` and rests on a search-engine snippet of that page, not on retrieved page bytes. Where a product's documentation does not answer a column, the cell reads `not documented` rather than a guess.

---

## 1. Comparable schedulers

| Product                   | Per-channel status?                                                                                                                                                                                                                                                                                                                                         | Partial state word?                                                                                                                                                                                                                                                       | Retry failed only?                                                                                                                                                                                                                                                                                                                      | Editing after partial?                                                                                                                                                                       | Source | Confidence                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| **Buffer**                | **Yes, by decomposition** — "once it's been scheduled, we consider each post to be its own separate post" [S1]                                                                                                                                                                                                                                              | **None, and none is representable** — after scheduling there is no parent post to be partial [S1]. The publishing-overview article documents multi-channel _composition_ only, never per-channel outcome tracking or a partial state [S2]                                 | `inferred` yes-by-construction (each channel's post is independent); no retry affordance is documented                                                                                                                                                                                                                                  | **Locked per row**: "At this time, we are unable to edit or delete a post once it's been published through Buffer" [S1]. The sibling channel's post is a distinct post and is unaffected     | S1, S2 | documented (decomposition, lock); `inferred` (retry)     |
| **Postiz** (open source)  | **Yes, explicitly** — one `Post` row **per `integrationId`**, each carrying its own `state State @default(QUEUE)`, its own `error String?`, its own `releaseURL String?`; sibling rows are tied together by a `group String` field [S3]. The public API confirms the request shape: a `posts` array where each element names exactly one `integration` [S4] | **None** — `enum State { QUEUE PUBLISHED ERROR DRAFT }` [S3]. Partiality is only representable as a mixed set of children under one `group`; there is no parent entity and no parent status                                                                               | not documented (`inferred` possible per row by construction)                                                                                                                                                                                                                                                                            | not documented                                                                                                                                                                               | S3, S4 | documented (schema is source of truth)                   |
| **Mixpost** (open source) | **Not confirmed.** `PostStatus` is **post-level**, not per-account [S5]. A per-account error store could not be confirmed from the sources I could read [S6]                                                                                                                                                                                                | **None** — `enum PostStatus: int { case DRAFT = 0; case SCHEDULED = 1; case PUBLISHED = 2; case FAILED = 3; }` [S5]                                                                                                                                                       | **not documented / unverified.** A search summary asserted Mixpost "only retries the platforms that failed"; it could not be confirmed in Mixpost's own source or docs and appears to conflate a different product's API. Treated as **unverified — do not rely on it**                                                                 | **Locked at the parent**: "Posts that are published/failed cannot be edited", via `isInHistory()` (published or failed ⇒ non-editable) [S6]                                                  | S5, S6 | documented (enum, lock); unverified (retry, per-account) |
| **ContentStudio**         | **Yes** — "On the left-hand side, under **Post account and status**, locate the social accounts with a warning sign" [S7]                                                                                                                                                                                                                                   | **Yes — "Partially Failed"**, a user-visible status "which indicates the content didn't publish to all selected accounts" [S7]. This is the only _verified_ customer-facing use of the partial word                                                                       | **Yes** — a "Retry" button on failed accounts for immediate republication; for future publishing, "Duplicate" with only the failed accounts kept. Explicit instruction: "deselect any accounts where it was successfully published to avoid rescheduling or republishing there. Keep only the accounts where it failed to publish" [S7] | **Not in place for rescheduling** — "The original post cannot be retried in place for partial failures; instead, you must duplicate it and adjust account selections before scheduling" [S7] | S7     | documented                                               |
| **Publer** (API)          | **Yes, at the API level** — a publish job returns `status: "complete"` with `payload.failures` keyed per account [S8]                                                                                                                                                                                                                                       | **Yes, as a named API concept** — the docs instruct you to "check failures object for partial failures" when the job reaches `"complete"` [S8]. Note the job status is `complete`, **not** `failed`                                                                       | not documented (on the fetched page)                                                                                                                                                                                                                                                                                                    | not documented                                                                                                                                                                               | S8     | documented                                               |
| **Hootsuite**             | `secondary` — "When a message fails to send to one or more social networks, the reason for the failure will be displayed"; failed posts appear in red in the Planner [S9]                                                                                                                                                                                   | not documented                                                                                                                                                                                                                                                            | `secondary` — mobile offers "Edit Failed Posts and Try Again" [S9]                                                                                                                                                                                                                                                                      | not documented                                                                                                                                                                               | S9     | **secondary** (HTTP 401 on direct fetch; snippet only)   |
| **Sprout Social**         | `secondary` — a dedicated "Failed Stream" lists posts that failed to publish; per-profile granularity is `inferred` [S10]                                                                                                                                                                                                                                   | not documented                                                                                                                                                                                                                                                            | `secondary` — from the Failed Stream you can "revise, resubmit or resend a post" [S10]                                                                                                                                                                                                                                                  | not documented                                                                                                                                                                               | S10    | **secondary** (HTTP 403; snippet only)                   |
| **SocialBee**             | `secondary` — a "Failed posts" list under Next Posts, each carrying a failure label [S11]                                                                                                                                                                                                                                                                   | not documented                                                                                                                                                                                                                                                            | `secondary` — a "Retry now" button per failed item [S11]                                                                                                                                                                                                                                                                                | not documented                                                                                                                                                                               | S11    | **secondary** (HTTP 403; snippet only)                   |
| **Zoho Social**           | not documented                                                                                                                                                                                                                                                                                                                                              | **None** — two buckets only: "**Failed Posts** displays a list of your scheduled posts that weren't published" and "**Unattempted Posts** displays a list of posts that failed to go live when you published them" [S12]. Neither addresses multi-channel partial failure | not documented                                                                                                                                                                                                                                                                                                                          | not documented                                                                                                                                                                               | S12    | documented-negative                                      |
| **Later**                 | not documented — no primary source retrieved                                                                                                                                                                                                                                                                                                                | —                                                                                                                                                                                                                                                                         | —                                                                                                                                                                                                                                                                                                                                       | —                                                                                                                                                                                            | —      | **not researched**                                       |

**Pattern across the table.** Two families, and both avoid a stored aggregate partial state:

1. **Decompose and drop the parent** (Buffer, Postiz, Twilio [S20]): the per-effect row _is_ the record; there is no parent status to be partial, and any group view is derived at read time.
2. **Keep the parent, derive the word** (ContentStudio, Publer): a per-account outcome panel/object exists, and "Partially Failed" / "partial failures" is a _projection over the children_, not a value in a stored enum.

No product I verified stores a `PARTIALLY_PUBLISHED`-style value in its status enum. Both open-source enums I read verbatim [S3, S5] omit it.

---

## 2. Saga forward recovery with N independent external effects

### 2.1 The post-pivot rule — why today's outcome is the defect

Azure, §"Key concepts in the Saga pattern" [S13], verbatim:

> **Pivot transactions** serve as the point of no return in the saga. After a pivot transaction succeeds, compensable transactions are no longer relevant. **All subsequent actions must be completed for the system to achieve a consistent final state.**

> **Retryable transactions** follow the pivot transaction. Retryable transactions are idempotent and help ensure that the saga can reach its final state, even if temporary failures occur. They help the saga eventually achieve a consistent state.

Richardson, ch. 4 [S16] (`secondary` — snippet of the book text): "The pivot transaction is the go/no-go point in a saga. If the pivot transaction commits, **the saga will run until completion.**" Retriable transactions "follow the pivot transaction and are guaranteed to succeed."

Richardson, microservices.io [S15], verbatim: "If a local transaction fails because it violates a business rule then the saga executes a series of compensating transactions that undo the changes that were made by the preceding local transactions." — i.e. the compensating branch is defined only for the pre-pivot segment.

**Implication for omni-post.** `SchedulePublishingJobsStep` is the declared pivot [S23]; `WaitForPublishingCompletionStep` and `UpdatePostStatusStep` are its `postCommit` retryable steps [S23]. A partial failure currently terminates the saga `FAILED` with the post left `DRAFT` — which is neither the compensated pre-state (impossible past the pivot) nor the forward-completed state. That is a direct violation of the rule quoted above, and it is not a cosmetic one: the client helper treats `FAILED` as a thrown error and `SAGA_TERMINAL_STATUSES` closes the poll loop, so the customer's only signal is an exception over channels that _did_ publish [S24]. The correct target state is forward-complete with the outcome recorded per channel.

### 2.2 The canonical shape for N independent effects: one state record per effect

The closest canonical fit is **not** the saga pattern page but Azure's **Scheduler Agent Supervisor** pattern [S14], whose stated context is "tasks that include multiple steps, some of which might invoke remote services… The individual steps might be independent of each other". Verbatim:

> The **Scheduler** maintains information about the progress of the task and **the state of each step** in a durable data store, called the **state store**.

> As each step is performed, the Scheduler records the state of the workflow, such as "step not yet started," "step running," or "step completed."

> In a more complex multistep scenario, the submission process would likely involve several steps, and so **several records would be created in the state store — each one describing the state of an individual step.**

> The **Supervisor** monitors the status of the steps in the task being performed by the Scheduler… If it detects any that have timed out or failed, it arranges for the appropriate Agent to **recover the step** or execute the appropriate remedial action.

**Implication for omni-post's wait step.** Today the wait step reads **counts only**, through a `PublishJobsStatusReader` [S23]. A count is an aggregate over a state store whose per-step records the saga never sees. SAS says the per-step record is the primitive and the aggregate is derived from it. The per-channel publication record Edward signed _is_ that state store — relocated from the saga's own store into the Post aggregate, which is a stronger placement because it survives the saga and is what the customer reads.

### 2.3 Retry scope: the step, never the task

SAS scopes recovery to the individual failed step, with a per-step failure counter and a threshold [S14]:

> the Supervisor could maintain a **retry count for each step**, along with the state information, in the state store. If this count exceeds a predefined threshold…

> If the failure count value exceeds a specified threshold, the reason for the failure is assumed to be **nontransient**. The Supervisor sets the status of the order to error and **raises an event that alerts an operator**.

> If the Agent detects an **unrecoverable, nontransient fault**… The Scheduler can set the status of the order to error and raise an event that alerts an operator. **The operator can then try to resolve the reason for the failure manually and resubmit the failed processing step.**

This is a direct canonical endorsement of the signed decision: **transient → automatic retry and the post stays "in progress"; a problem of the channel's own (misconfiguration, suspended account) → stop retrying, surface it, and let the human resubmit that step**. The human retry in the customer UI is precisely SAS's "operator resubmits the failed processing step".

### 2.4 Idempotency and stable retry identity

> The steps performed by an Agent could be run more than once. The logic that implements these steps should be **idempotent**. [S14]

> When you implement retry logic, **pass a stable identifier across all retry attempts** so that the remote service can use it for any deduplication logic that it might have. [S14]

Azure's saga page repeats the requirement under §"Problems and considerations": "The system must handle transient failures effectively and ensure idempotence" [S13].

**Implication.** Per-channel retry needs a stable per-channel identity that survives retries. The existing `PublishLog` upsert keyed by `(postId, channelId)` is the natural anchor. The project's own canon already forbids the wrong answer here: saga dedupe keys are deterministic (`cmd-${sagaId}-${stepId}`) and fitness **#7** hard-blocks `randomUUID`/`Math.random` in a `dedupeKey`. A per-channel retry attempt must therefore derive its key from `(postId, channelId, attempt)` or equivalent, never from a fresh UUID.

### 2.5 Concurrency countermeasures that become relevant once retry exists

Azure, §"Strategies to address data anomalies" [S13], verbatim list: **Semantic lock** ("application-level locks when a saga's compensable transaction uses a semaphore to indicate that an update is in progress"), **Commutative updates** ("Design updates so that they can be applied in any order while still producing the same result"), **Pessimistic view** ("Reorder the sequence of the saga so that data updates occur in retryable transactions to eliminate dirty reads"), **Reread values** ("Confirm that data remains unchanged before you make updates. If data changes, stop the current step and restart the saga as needed"), **Version files** ("Maintain a log of all operations performed on a record and ensure that they're performed in the correct sequence"), **Risk-based concurrency based on value**.

Richardson's semantic lock, ch. 4 [S16] (`secondary`): "an application-level lock, in which saga's compensable transactions set a flag in any record that it creates or updates. This flag indicates that the record is not committed and that it has the potential to change."

**Two implications, both actionable at propose time.**

- **The existing `RereadCheck` will refuse the retry path.** The pivot step carries a reread countermeasure whose predicate is literally `status !== "DRAFT"` ⇒ `stillValid: false`, with the reason string `Post.status is ${status}, expected DRAFT` [S23]. A retry of the two missing channels happens when the post is _not_ `DRAFT` (it is partially published). The countermeasure was written against a single-shot assumption and must be re-specified, or the saga's own guard aborts every retry.
- **Commutative updates are the natural fit for N concurrent channel outcomes.** Channel outcomes arrive in arbitrary order and the derived post status is order-independent; designing the child write as commutative ("applied in any order while still producing the same result" [S13]) avoids needing a lock on the common path, and reserves the semantic lock for the narrower race of a second saga/retry starting on the same post.

---

## 3. Aggregate boundary: child record inside `Post` vs separate aggregate keyed by `(postId, channelId)`

### 3.1 The rule that decides it

Vernon, _Implementing Domain-Driven Design_, ch. 10, "Rule: Model True Invariants in Consistency Boundaries" [S17], verbatim:

> An invariant is a business rule that must always be consistent.

> The consistency boundary logically asserts that everything inside adheres to a specific set of business invariant rules no matter what operations are performed.

> A properly designed Aggregate is one that can be modified in any way required by the business with its invariants completely consistent **within a single transaction**.

> The consistency of everything outside this boundary is irrelevant to the Aggregate.

"Rule: Reference Other Aggregates by Identity" [S18], verbatim:

> one Aggregate may hold references to the Root of other Aggregates. However, we must keep in mind that this does not place the referenced Aggregate inside the consistency boundary of the one referencing it.

> Both the referencing Aggregate (BacklogItem) and the referenced Aggregate (Product) **must not** be modified in the same transaction. Only one or the other may be modified in a single transaction.

> If you are **modifying multiple instances in a single transaction, it may be a strong indication that your consistency boundaries are wrong.**

> Prefer references to external Aggregates only by their globally unique identity, not by holding a direct object reference.

### 3.2 What that implies here

**The decisive question is whether a true invariant binds the per-channel records to the post.** Two of the signed decisions say yes, and both are **set-level** — neither can be decided from one child in isolation:

1. **The derived post status is a function of the complete set of channel outcomes.** "All OK ⇒ PUBLISHED" is not knowable from one row.
2. **"Content locks the moment the first channel publishes"** is a predicate over the set: _does any child have a successful outcome?_ Editing the post body is a root operation whose legality depends on the children.

By Vernon's rule, a rule that "must always be consistent" and must hold "within a single transaction" places its subject **inside** the boundary. Conversely, modelling `PostChannelPublication` as a **separate aggregate keyed by `(postId, channelId)`** forces exactly the shape Vernon names as the symptom of wrong boundaries: the worker's per-channel write and the post's derived-status/lock recomputation would be two aggregate instances mutated in one transaction. **The evidence therefore supports the signed decision — the child belongs inside the `Post` boundary.**

Three corollaries that follow from the same citations and from the project's own canon:

- **`channelId`, not `Channel`.** `Channel` is its own aggregate; the child holds a `ChannelId` value object, by Vernon's identity rule [S18] and by ARCHITECTURE_CANON §Aggregates ("Reference other aggregates **by ID only**"). ADR-0016 already makes channel the canonical targeting unit, so the child's key is `channelId` and the provider is derived from it — not stored twice.
- **The root is the only writer.** ARCHITECTURE_CANON §Aggregates: "Aggregate root is the only public entry point — no direct child mutation from outside." A worker that writes the child row directly would violate the project's own canon once the child lives inside `Post`. The per-channel outcome must be applied through a `Post` method (e.g. `recordChannelOutcome(channelId, outcome, reason)`), which is also where the "lock on first success" invariant gets enforced.
- **The outbox stays in the same transaction** as the aggregate save (ARCHITECTURE_CANON §Event-Driven Architecture), and the `Result`-returning save path belongs on `executeResultInTransaction` (ADR-0023), not `executeInTransaction` — this change is precisely the multi-statement aggregate save that ADR-0023 was written for (row + children + outbox), where an `err` after the first statement would otherwise commit a partial write.

### 3.3 The counter-pressure, stated honestly

Vernon's companion rule, "Design Small Aggregates", pushes the other way, and there is a **real** cost here: a `Post` with up to 11 channel children means every worker completion contends on the post's optimistic-concurrency version. With N workers finishing near-simultaneously, root-mediated child writes will produce conflict retries at exactly the moment the system is busiest.

The field evidence leans against the large aggregate: Postiz [S3] and Buffer [S1] both chose _no parent entity at all_, and Twilio [S20] likewise creates one independently-statused resource per recipient. None of them carries a set-level invariant, though — Buffer and Mixpost resolve "can I still edit?" by locking **per row** [S1] and **at the parent once it is published or failed** [S6] respectively, not by a live predicate over children.

**This is a genuine design fork for `sdd-design`, not a settled matter.** Two admissible shapes, both canon-legal:

- **(a) Strong boundary.** Child inside `Post`, root-mediated writes, conflict-retry on the version. The content lock is immediately consistent. Cost: write contention proportional to channel count.
- **(b) Eventually-consistent rollup.** Child row written independently; derived status and lock recomputed in a separate transaction. Vernon explicitly sanctions eventual consistency for what sits outside a boundary [S17, S18] — but choosing it makes "content locks the moment the first channel publishes" _eventually_ true, which is a **product** decision (a brief window where a customer can edit content that is already live on one network), not a technical one. It must go back to Edward if design prefers it.

---

## 4. Status vocabulary precedent — is a user-visible `PARTIALLY_PUBLISHED` supported?

**Evidence FOR the word being user-visible:**

- **ContentStudio** shows customers a **"Partially Failed"** status meaning "the content didn't publish to all selected accounts" [S7]. This is the strongest direct precedent: a real product, a real customer-facing status word, for exactly this situation.
- **Publer's API** names the concept explicitly — "check failures object for **partial failures**" [S8] — confirming that partiality is a first-class thing to report, not an internal detail to hide.
- **Google Ads API** makes partial commit an explicitly named, opt-in semantic: "Operations within a single API request are executed as one set of actions by default, meaning they either all succeed together or the whole batch fails if any single operation fails. Some services support a `partialFailure` attribute to change this behavior" [S21, S22]. Precedent that partial commit should be a _named, deliberate_ semantic rather than an emergent accident — which is what omni-post has today.

**Evidence AGAINST it being a _stored_ state:**

- **RFC 4918 §11.1/§13** [S19] is the general principle and the strongest argument: `207 Multi-Status` exists because a single status code "proves inadequate" when a method "may operate over many resources", and critically, "the Multi-Status response itself carries no inherent indication regarding success or failure of the constituent operations". The outcome of N independent effects **must not be collapsed into one scalar**; the per-effect statuses are carried and the consumer decides. Mapped here: the per-channel records are the truth, and any post-level word is a projection over them.
- **Twilio** [S20] has no batch-level status at all — "when sending to multiple recipients, you create separate Message resources for each recipient, each with its own status lifecycle."
- **Postiz** `State { QUEUE PUBLISHED ERROR DRAFT }` [S3] and **Mixpost** `PostStatus { DRAFT, SCHEDULED, PUBLISHED, FAILED }` [S5] — the two enums I read verbatim — both omit a partial value.
- **Publer** reports the containing job as `status: "complete"`, **not** `failed`, when some accounts fail [S8]: the aggregate outcome word stays positive and partiality lives in the detail.

**Terminal vs transitional.** The evidence is split and this is the one genuinely open product question:

- **ContentStudio treats partial as effectively terminal**: an immediate "Retry" exists per failed account, but for rescheduling "the original post cannot be retried in place… you must duplicate it" [S7].
- **SAS treats it as a resting state awaiting the operator**: "The operator can then try to resolve the reason for the failure manually and **resubmit the failed processing step**" [S14].

Edward's signed decision (partial is user-visible **and** the user retries the missing channels in place) matches the SAS shape and is **more ambitious than any product behaviour I could verify**. It is not contradicted by anything found; it is simply unprecedented among the verified products, and architecturally supported.

**Net reading.** The evidence supports making the partial word **user-visible** and supports making the post-level status **derived rather than stored** — which is exactly what was signed. It does _not_ support adding `PARTIALLY_PUBLISHED` as a persisted column alongside `DRAFT`/`PUBLISHED`.

---

## 5. Synthesis for propose

1. **The per-channel publication record is confirmed by four independent primaries** (Postiz's per-integration `Post` rows with their own `state`/`error`/`releaseURL` [S3]; Buffer's "each post to be its own separate post" [S1]; Publer's per-account `failures` object [S8]; Twilio's per-recipient Message resources [S20]) **and by canon** (SAS: "several records would be created in the state store — each one describing the state of an individual step" [S14]). No contradiction with the signed decisions.

2. **Derived post-level status is confirmed and the stored-enum alternative is contradicted.** Neither open-source enum I read verbatim contains a partial value [S3, S5], and RFC 4918 §13 states the general principle that N independent outcomes must not be collapsed into one scalar [S19]. Propose should specify `PARTIALLY_PUBLISHED` as a **projection**, not a column.

3. **The real defect is named by canon, not just by us.** Post-pivot, "All subsequent actions must be completed for the system to achieve a consistent final state" [S13] and "the saga will run until completion" [S16]. Terminating `FAILED` with the post left `DRAFT` while two channels are live is the violation; the mechanical cause is that `WaitForPublishingCompletionStep` reads **counts** through `PublishJobsStatusReader` [S23] instead of per-channel outcomes. Fixing the wait step's _read_ is the minimum, and the per-channel record is what makes the fix possible.

4. **Retry must be scoped to the channel, never the post**, with a per-channel attempt counter and a threshold beyond which the failure is deemed nontransient and surfaced to the human [S14]. That threshold is the exact seam between "in progress with retry" and "PARTIALLY_PUBLISHED, user-visible" in the signed decisions — propose should name the budget explicitly rather than leaving it to the saga's global `maxRetries: 3` [S23].

5. **Tension #1 — the content-lock invariant vs small aggregates.** "Locks on first publish" is a set-level predicate, which is the strongest argument for the child living inside `Post` [S17, S18]; but 11 concurrent channel writers contending on one aggregate version is a real cost, and every comparable product avoided it by having no parent at all [S1, S3, S20]. `sdd-design` must choose explicitly between root-mediated writes with conflict retry and an eventually-consistent rollup — and if it prefers the latter, the weakened lock guarantee goes back to Edward, because it is a product decision.

6. **Tension #2 — the existing pivot countermeasure blocks the retry path.** The pivot's `RereadCheck` aborts unless `Post.status === "DRAFT"` [S23]. A retry of the missing channels runs when the post is partially published. Unchanged, this guard refuses every retry. The spec must re-state the pivot's precondition in terms of the per-channel record (is _this channel_ unpublished?) rather than the post's global status.

7. **Tension #3 — in-place retry exceeds verified precedent.** ContentStudio, the only product verified to show customers a partial status, requires duplicate-and-reschedule rather than in-place retry [S7]. Edward's decision is architecturally sound (it is SAS's operator-resubmit [S14]) but has no verified product twin. Worth naming in the proposal as a deliberate differentiator with its own UX risk (double-publish if the retry is not idempotent).

8. **Open risks the evidence does not resolve.** (a) Whether `PARTIALLY_PUBLISHED` is terminal or a resting state once the operator fixes the channel — the sources split [S7] vs [S14]; product call. (b) Whether a channel excluded for its own problem should be re-includable after remediation without re-opening the content lock. (c) Later was not researched and three vendor help centers (Hootsuite, Sprout Social, SocialBee) blocked direct fetch — their rows are `secondary` and must not be quoted as verbatim vendor wording.

---

## 6. Sources

**External — retrieved directly (page body read):**

1. **[S1]** Buffer Help Center, "Scheduling posts" — https://support.buffer.com/article/642-scheduling-posts — accessed 2026-09-16 — per-channel decomposition after scheduling; no-edit-after-publish lock.
2. **[S2]** Buffer Help Center, "Getting started with Buffer's publishing features" — https://support.buffer.com/article/600-getting-started-with-buffers-publishing-features — accessed 2026-09-16 — **negative result**: documents multi-channel composition only; no per-channel outcome tracking, no partial state.
3. **[S3]** Postiz, Prisma schema (source of truth, open source) — https://raw.githubusercontent.com/gitroomhq/postiz-app/main/libraries/nestjs-libraries/src/database/prisma/schema.prisma — accessed 2026-09-16 — `enum State { QUEUE PUBLISHED ERROR DRAFT }`; `Post.state`, `Post.error`, `Post.releaseURL`, `Post.integrationId`, `Post.group`.
4. **[S4]** Postiz, "Public API" — https://docs.postiz.com/public-api — accessed 2026-09-16 — request shape: `posts` array, one `integration` per element.
5. **[S5]** Mixpost, `src/Enums/PostStatus.php` — https://raw.githubusercontent.com/inovector/mixpost/main/src/Enums/PostStatus.php — accessed 2026-09-16 — verbatim enum, four cases, no partial.
6. **[S6]** DeepWiki, "Post Management — inovector/mixpost" — https://deepwiki.com/inovector/mixpost/3-post-management — accessed 2026-09-16 — **secondary** (machine-generated over Mixpost source) — `isInHistory()` / non-editable-after-publish-or-fail; confirms per-account error storage is _not_ documented there.
7. **[S7]** ContentStudio Help Center, "How to publish or reschedule failed posts on Facebook & Instagram" — https://docs.contentstudio.io/article/1053-how-to-publish-or-reschedule-failed-posts-on-facebook-instagram — accessed 2026-09-16 — "Partially Failed" status; "Post account and status" per-account panel; Retry vs Duplicate; deselect-published instruction.
8. **[S8]** Publer API docs, "Publishing Methods" — https://publer.com/docs/posting/create-posts/publishing-methods — accessed 2026-09-16 — job `status` values `working`/`complete`/`failed`; `payload.failures`; "check failures object for partial failures".
9. **[S12]** Zoho Social, "Rescheduling Unpublished Posts" — https://help.zoho.com/portal/en/kb/social/managing-posts/articles/rescheduling-unpublished-posts — accessed 2026-09-16 — "Failed Posts" / "Unattempted Posts"; **negative result** on multi-channel partial failure.
10. **[S13]** Microsoft, Azure Architecture Center, "Saga design pattern" (ms.date 2025-02-25) — https://learn.microsoft.com/en-us/azure/architecture/patterns/saga — accessed 2026-09-16 — §Key concepts (compensable / pivot / retryable); §Problems and considerations (idempotence, irreversible local changes, compensation limits); §Strategies to address data anomalies (six countermeasures verbatim).
11. **[S14]** Microsoft, Azure Architecture Center, "Scheduler Agent Supervisor pattern" (ms.date 2022-07-28) — https://learn.microsoft.com/en-us/azure/architecture/patterns/scheduler-agent-supervisor — accessed 2026-09-16 — Scheduler/Agent/Supervisor roles; state store with one record per step; per-step `FailureCount` and threshold; transient vs nontransient split; operator resubmits the failed step; stable retry identifier; step idempotency.
12. **[S15]** Chris Richardson, microservices.io, "Pattern: Saga" — https://microservices.io/patterns/data/saga.html — accessed 2026-09-16 — saga definition; compensating transactions scoped to preceding local transactions. **Note:** this page does **not** contain the pivot/compensatable/retriable taxonomy or the countermeasures list.
13. **[S17]** Vaughn Vernon, _Implementing Domain-Driven Design_, ch. 10 "Aggregates" — InformIT excerpt, "Rule: Model True Invariants in Consistency Boundaries" — https://www.informit.com/articles/article.aspx?p=2020371&seqNum=2 — accessed 2026-09-16.
14. **[S18]** Same work — "Rule: Reference Other Aggregates by Identity" — https://www.informit.com/articles/article.aspx?p=2020371&seqNum=4 — accessed 2026-09-16.
15. **[S19]** IETF RFC 4918 (HTTP Extensions for WebDAV), §11.1 `207 Multi-Status` and §13 Multi-Status Response — https://www.rfc-editor.org/rfc/rfc4918#section-13 — accessed 2026-09-16 — a single status code is inadequate for multi-resource operations; the 207 response itself indicates nothing about the constituent outcomes.
16. **[S20]** Twilio, "Message Resource" — https://www.twilio.com/docs/messaging/api/message-resource — accessed 2026-09-16 — six per-message status values verbatim; status is per-message/per-recipient; no batch-level or partial status.
17. **[S21]** Google, Google Ads API, "Mutate" (REST common) — https://developers.google.com/google-ads/api/rest/common/mutate — accessed 2026-09-16 — default all-or-nothing; `partialFailure` opts into partial commit.
18. **[S22]** Google, Google Ads API, "Bulk Mutates" — https://developers.google.com/google-ads/api/docs/mutating/bulk-mutate — accessed 2026-09-16 — confirms the bulk endpoint "supports partial failure and validate-only features"; field-level detail lives in [S21].

**External — blocked on direct fetch; content via search-engine snippet only (`secondary`, do not quote as vendor wording):**

19. **[S9]** Hootsuite Help Center, "Troubleshoot a scheduled post failure" — https://help.hootsuite.com/hc/en-us/articles/115005151107-Troubleshoot-a-scheduled-post-failure — accessed 2026-09-16 — **HTTP 401 Unauthorized** on direct fetch.
20. **[S10]** Sprout Social Support, "Failed post notifications" — https://support.sproutsocial.com/hc/en-us/articles/360032870391-Failed-post-notifications — accessed 2026-09-16 — **HTTP 403 Forbidden**.
21. **[S11]** SocialBee Help, "Posting Errors Explained" — https://help.socialbee.com/hc/en-us/articles/29979231388823-Posting-Errors-Explained — accessed 2026-09-16 — **HTTP 403 Forbidden**.
22. **[S16]** Chris Richardson, _Microservices Patterns_, ch. 4 "Managing transactions with sagas" — https://livebook.manning.com/book/microservices-patterns/chapter-4 — accessed 2026-09-16 — livebook body not retrievable; the pivot/compensatable/retriable definitions are search-engine snippets of the chapter text. **Prefer [S13], which carries the same semantics and was retrieved verbatim.**

**Internal — codegraph readback (cited for the implications sections, not as external evidence):**

23. **[S23]** `/root/omni-post/packages/shared/src/saga.ts` — `createPostPublishingSagaDefinition` (v2.0.0, 30-min timeout, `maxRetries: 3` exponential 5 s); `preCommit: [ValidatePostDataStep, CreatePostStep]`, `pivot: SchedulePublishingJobsStep`, `postCommit: [WaitForPublishingCompletionStep, UpdatePostStatusStep]`; `PublishJobsStatusReader` is the wait step's only input; the pivot's `RereadCheck` aborts with `Post.status is ${status}, expected DRAFT`; `SemanticLock` / `RereadCheck` / `VersionCheck` countermeasure interfaces.
24. **[S24]** `/root/omni-post/apps/client/lib/api/clients/sagaClient.ts` — `SAGA_TERMINAL_STATUSES`; `runSagaAndAwaitTerminal` throws on `FAILED` / `COMPENSATED`, so a partial failure surfaces to the customer only as an exception.
