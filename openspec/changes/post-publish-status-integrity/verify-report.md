```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: "sha256:ef71ad6beadf057a1806be0db3eae57b458fd9dd32a71676b9e57ddacdad46d6"
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: "10/10"
scenarios: "32/32"
test_command: "pnpm --dir apps/api exec vitest run tests/unit/sagaDeterministicIds.test.ts tests/unit/PostCommandHandlers.update.test.ts tests/unit/integrationEventDeliveryHandler.test.ts tests/unit/PostCommandHandlers.create.test.ts tests/unit/PostCommandHandlers.publish.test.ts tests/unit/PostCommandHandlers.complete-publishing.test.ts && pnpm --dir packages/core/posts exec vitest run"
test_exit_code: 0
test_output_hash: "ba58d31bb94df88eb2c861bcbeb70567d86d318032b7315fa9e14e6489da07e4"
build_command: "NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc --noEmit"
build_exit_code: 0
build_output_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
```

# Verification Report — post-publish-status-integrity (N-COR-1) — rev 2

**Change**: `post-publish-status-integrity` · **Store**: openspec · **Mode**: Strict TDD ACTIVE
**Candidate**: `workstream/post-publish-status-integrity-pr2` at `840bac80` (7 commits over `origin/main`
`8887a02a`, PR 1 merged as #259) **plus the verify corrective, uncommitted — 7 files, all evidence, no
source file touched**.
**Supersedes** rev 1 of this report, which returned FAIL on two CRITICAL findings. Both are closed and
re-verified here by my own runs, not by reading the corrective's claims.

---

## Verdict: PASS WITH WARNINGS

**0 CRITICAL · 3 WARNING · 5 SUGGESTION.** 10 of 10 requirements satisfied; 32 of 32 scenarios covered.

Every merge-blocking scenario now has a covering test that **passed at runtime in this phase**, including
the integration tier, which rev 1 could only attest from the apply record. The three remaining warnings
are: an artefact that does not exist yet (the PR body — orchestrator-owned), an accepted budget
overshoot, and a deliberately deferred residual with a backlog row. None blocks archive on its own.

### What changed since rev 1

| rev 1 finding                                                                                    | Now                                 | How I re-verified it                                                                                               |
| ------------------------------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **C1** R4 scenario 2 untested                                                                    | **CLOSED**                          | Ran the suite myself; the new case is green — see below                                                            |
| **C2** R5 scenario 3 untested                                                                    | **CLOSED**                          | Ran the suite myself; the new case is green — see below                                                            |
| **W1** integration batch not re-executed                                                         | **CLOSED**                          | I ran `integration:saga-recovery` myself: **33 tests / 33 pass / 0 fail / 0 cancelled / 0 skipped**, runner exit 0 |
| **W3** R8 cross-tenant clause unasserted                                                         | **downgraded to SUGGESTION**        | The write direction is now asserted; the read direction is named as out of reach in the test's own comment         |
| **W5** 8 type diagnostics with no backlog row                                                    | **CLOSED**                          | SMELL-124 landed at `roadmap-detected-smells-backlog.md:177`                                                       |
| **W7** design Open Questions unticked                                                            | **CLOSED**                          | Both boxes are `[x]` and cite A1 / A7                                                                              |
| **S1** tasks.md said 33 scenarios                                                                | **CLOSED**                          | `tasks.md:3` now says 32; my re-count agrees (32)                                                                  |
| **S2** config.yaml cites `#1-#40`                                                                | **WITHDRAWN — my error, see below** | Re-measured: the file cites **41**                                                                                 |
| **W2** PR body · **W4** budget · **W6** SMELL-121 · **S3** Spanish JSDoc · **S4** heredoc writes | unchanged                           | carried forward                                                                                                    |

### S2 withdrawn — the refutation is correct, and the mistake was mine

Rev 1 claimed `openspec/config.yaml` still cites `#1-#40` while the suite has 41. **Re-measured here: the
file cites 41 in all three places** — `:21` ("41 CI fitness functions"), `:62` ("`#1-#41`"), `:86` ("Run
all 41 fitness functions"), and has since commit `8ec9f4a7`. The claim is false.

The mistake is worth naming rather than quietly deleting: I repeated a residual line carried in
`proposal.md:64` and `design.md:198` as if it were a finding, instead of opening the file it was about.
A verify phase that forwards an artifact's claim without measuring it is doing the thing this change
exists to stop — reporting a state nobody checked. The corrective's B9 row records the measurement;
what survives is only that those two artifacts still carry the stale sentence (S7 below).

---

## WARNING (3)

### W2 — R2's PR-body half is still not materialized

R2 scenario 1 is `[static]` over two artefacts. The design half is discharged three times over:
`design.md` D9, the code comment at `apps/api/src/integrations/IntegrationEventDeliveryHandler.ts:27-37`,
and the engram mirror. The PR body is drafted and correct — it states D9 in full, names the
counterfactual timing, and carries the D10 residual — but **the PR does not exist**, so the artefact the
scenario names is not in the world yet. This is orchestrator-owned and cannot be closed from here.

**Remedy**: open the PR with that body. Until then the scenario is satisfied in substance and short one
artefact in form.

### W4 — the review budget is breached on both axes, and the corrective widened it

CODE is **unchanged at 855** — the corrective touched no source file, which is the right shape for a
test-only corrective and is verified rather than assumed (`git diff --name-only` over the uncommitted set
yields no path outside `tests/`, `docs/` and `openspec/`). EVIDENCE rises from 2,990 to **3,404** against
the ratified hard stop of 2,000. Edward accepted the overshoot on 2026-09-16; the corrective's 414 lines
bought two merge-blocking proofs and a cross-tenant assertion, which is the right thing to spend evidence
on. The warning stands because a reviewer now meets 4,259 changed lines across 31 files.

### W6 — SMELL-121 ships unfixed, and it is this change's own observable through another door

`CompletePostPublishingUseCase.resolveProviders` (`:326-347`) needs one field, `channel.provider.type`,
and reaches it through `ChannelRepository.findById`, which reconstitutes the whole `Channel` and decrypts
its credentials envelope. An undecryptable envelope makes the adapter **throw** rather than return `err`,
so it escapes the unresolved-channel path D7 designed for exactly this case, reaches the outer
`classifyPersistenceFailure`, and blocks a promotion whose publish genuinely completed — a post left
`DRAFT` while the provider holds it, which is the defect this change exists to delete.

Named in `design.md` Residuals, `apply-progress.md`, the PR-body draft, and as SMELL-121 with the
throwing sites located. Deferring it is defensible — the sound fix is a port method that resolves a
provider without credentials, a domain-port change with its own adapter and tests — and it is recorded
here because the change's own success criterion is reachable through it.

---

## SUGGESTION (5)

- **S3** — B8 stands: the `UnitOfWork` interface JSDoc at
  `packages/core/domain/src/repositories/Repository.ts:164-172` remains Spanish, against the coding
  standards' comment-quality rule. The new member's JSDoc at `:183-205` is English, as A6 required.
  Deliberate and backlogged.
- **S4** — historical: three files were written by Bash heredoc while the pre-edit hook was timing out,
  skipping their pre-write gate; the gatekeeper replayed the hook's four tripwire regexes over all 15
  non-`.md` touched files afterwards (0 hits). The right recovery; worth not repeating.
- **S5** (was W3) — **the cross-tenant assertion proves the WRITE direction only.** R8's scenario says "no
  cross-tenant row was reachable by the transaction"; the new case
  (`sagaPublishNowPromotion.test.ts:346-383`) proves the foreign row and its outbox are byte-identical
  before and after a promotion running under the other tenant. It does not attempt a cross-tenant READ
  inside the promoting transaction. The gap is stated in the test's own comment rather than covered by a
  stronger-sounding name, which is the correct calibration — a test that claimed unreachability while
  proving non-mutation would be worse than this one. Recorded as a suggestion, not a warning, because the
  limit is documented where a reader meets it.
- **S6** — `publishNowPromotionHarness.ts` is back to **620** lines, above the `≤ ~600` instruction that
  an earlier corrective split it down to 552 for. The 68 added lines are `seedForeignTenantPost`,
  `rewindToStep` and their teardown, all of which belong in the harness. Either raise the instruction
  deliberately or split again; do not let it drift silently. The suite itself is 437 lines.
- **S7** — the withdrawn-S2 sentence survives in `proposal.md:64` and `design.md:198`
  ("`openspec/config.yaml` cites `#1-#40`; the suite has 41") while `apply-progress.md:79` records the
  measurement that refutes it. Two artifacts of this change now disagree with a third. Also cosmetic: the
  two resolved Open Questions in `design.md:202-209` keep the original question text trailing after the
  resolution, so each box reads as resolved and then asks again.

---

## The two closures, re-verified rather than accepted

### C1 — R4 scenario 2 now has a covering test, and it is the right shape

`apps/api/tests/integration/sagaPublishNowPromotion.test.ts:216-288`, describe block
**"a completed saga whose promotion step is re-entered by a redelivered completion"**.

What makes it the right shape, read rather than taken on trust:

- **The step index is derived, not asserted in prose.** `PROMOTION_STEP_INDEX` comes from
  `createPostPublishingSagaDefinition(...).steps.findIndex(step => step.id === "update-post-status")`
  (`:34-47`), and the `before` hook asserts `PROMOTION_STEP_INDEX > REFERENCE_DEFINITION.pivotStepIndex`
  before anything else runs. A future reordering of the saga cannot silently turn this into the replay
  scenario — the premise is checked by the engine's own arithmetic.
- **Only the saga row is rewound.** `harness.rewindToStep`
  (`publishNowPromotionHarness.ts:419-452`) sets `status: RUNNING`, `currentStep`, clears
  `completedAt`/`nextRetryAt`/`retryCount`/`error` and drops the Redis copy. The post is left `PUBLISHED`
  with P1 — which is exactly what a redelivered completion event finds, and exactly what separates this
  from the two `sagaCrashRecovery` scenarios rev 1 examined (one rewinds to the pivot and ends FAILED on
  the reread countermeasure; the other also rewinds the post to `DRAFT`, so the promotion applies fresh).
  The comment at `:239-246` states that distinction.
- **The premise is asserted, not assumed**: the first run must reach `COMPLETED` and must have recorded a
  non-null `publishedAt`, or the re-entry proves nothing (`:233-239`).
- **The assertions are the four that matter**: `COMPLETED` after `manager.continueSaga`; `publishedAt`
  identical to the first run's; `version` unchanged; the outbox event-type list `deepStrictEqual` to the
  first run's.

**Re-verified by me**: the suite ran green in my own `integration:saga-recovery` run —
`ok 4 - a completed saga whose promotion step is re-entered by a redelivered completion`.

### C2 — R5 scenario 3 now has a covering test, with the discriminator the scenario needs

`packages/core/posts/tests/unit/CompletePostPublishingUseCase.test.ts:380-417`, case
**"recovers on the next attempt: a refused CONFLICT re-reads and promotes against the settled version"**.

The load-bearing detail is the assertion nobody could fake: the port double answers a **sequence** of
reads (`reads: [version 7, version 8]` — the concurrent writer settling between attempts), the first
`execute` carries a stale `expectedVersion: 3` and must return `CONFLICT` with zero saves, and the
second carries **no token at all** (because D4 means the saga forwards none) and must come back with
`version === 9`. Nine is the settled 8 advanced by this promotion's own save; a promotion that carried
the refused attempt's aggregate over would report 8. It also pins `findById` calls at 2 ("one load per
attempt") and `uow.calls` at 2 ("each attempt ran in its own transaction"), so the recovery cannot be
satisfied by a memoized read.

**Re-verified by me**: green in the verbose run of `packages/core/posts`, named in full.

---

## Requirement compliance matrix (R1–R10)

Legend: **PROVEN** — covering evidence executed or statically measured by me in this phase.
All integration evidence below was executed in this phase (W1 closed); nothing is attested from a record.

### R1 — total success reaches PUBLISHED through the aggregate, in one transaction [MERGE-BLOCKING]

| Scenario                                                             | Tag         | Evidence                                                                                                                                                                                                                                                | Status |
| -------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| a publish-now whose channels all succeed lands PUBLISHED             | integration | `sagaPublishNowPromotion.test.ts:70-79` — `COMPLETED`, `PUBLISHED`, `publishedAt !== null`, `version === 1` (one save, not two)                                                                                                                         | PROVEN |
| the event is in the outbox, written by the same transaction          | integration | `:81-94` — rows exactly `["PostPublishingStarted","PostPublished"]`, `providerResults` keys equal the channel ids                                                                                                                                       | PROVEN |
| a failed commit leaves nothing behind                                | integration | `:106-137` with `ThrowingOutboxWriter` — `DRAFT`, `publishedAt` null, `version` 0, outbox `[]`                                                                                                                                                          | PROVEN |
| the transition goes through the aggregate, not through a field write | static      | `CompletePostPublishingUseCase.ts:230` and `:238` the two hops; `:163` the single `executeResultInTransaction`; fitness #40 Part A non-seam = **0**, measured. Runtime: `CompletePostPublishingUseCase.test.ts:419-451` pins `save` 1 and `uow.calls` 1 | PROVEN |
| the previously dead promotion path is live                           | static      | grep over production `src`, measured: `startPublishing` and `markAsPublished` each have exactly one production caller                                                                                                                                   | PROVEN |

### R2 — the publishing-started event's delivery is DECIDED, not discovered [MERGE-BLOCKING]

| Scenario                                                     | Tag                | Evidence                                                                                                                                                                                      | Status              |
| ------------------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| the decision is recorded before the wiring ships             | static             | `design.md` D9; `IntegrationEventDeliveryHandler.ts:27-37` states the counterfactual timing and the best-effort fan-out; PR body drafted and engram-mirrored, PR not open (W2)                | PROVEN in substance |
| no subscriber sees a publish that started and never finished | integration + unit | Both rows committed together (`:81-94`); neither survives a rollback (`:126-136`). Outward delivery impossible by construction: `integrationEventDeliveryHandler.test.ts:69-84`, re-run green | PROVEN              |

### R3 — the command carries the outcome; anything short of total success is REFUSED [MERGE-BLOCKING]

| Scenario                                            | Tag    | Evidence                                                                                                                                                                                                                                       | Status |
| --------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| one channel short of total is refused               | unit   | `CompletePostPublishingUseCase.test.ts:228-249` — `NOT_IMPLEMENTED` naming N-COR-2, zero repo calls, **`uow.calls === 0`**                                                                                                                     | PROVEN |
| an unknowable outcome is refused, not assumed       | unit   | Schema `.min(1)` at `PostCommandHandlers.complete-publishing.test.ts:56-63`; the "fewer channels than scheduled" half only decidable at the step (D1) — `sagaDeterministicIds.test.ts:296-322`, four refusals each with **no command emitted** | PROVEN |
| an empty scheduled set is refused                   | unit   | `CompletePostPublishingUseCase.test.ts:214-226` and `sagaDeterministicIds.test.ts:300-302`                                                                                                                                                     | PROVEN |
| the outcome is observable at the moment it is built | static | `saga.ts:789-819`; pinned executably at `sagaDeterministicIds.test.ts:154-178`, which asserts both the identities and the index alignment, so a reordering cannot pass                                                                         | PROVEN |

### R4 — re-application is idempotent [MERGE-BLOCKING]

| Scenario                                                     | Tag         | Evidence                                                                                                                                                                                                  | Status |
| ------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| the promotion executed twice publishes once                  | integration | `sagaPublishNowPromotion.test.ts:139-195` — `applied:false`, `publishedAt` preserved and provably distinct from the second attempt's start, version unchanged, outbox unchanged                           | PROVEN |
| a retry after the promotion committed does not fail the saga | integration | **`:216-288`, the new re-entry case** — post-pivot index derived from the definition, only the saga row rewound, `COMPLETED`, P1 preserved, version unchanged, outbox identical. Green in my run (`ok 4`) | PROVEN |
| the terminal state is answered, not rejected                 | unit        | `CompletePostPublishingUseCase.test.ts:270-293` — success, `applied:false`, zero saves, zero events, the distinct fixture timestamp                                                                       | PROVEN |

### R5 — the promotion honours the OCC token, idempotent answer resolved FIRST [MERGE-BLOCKING]

| Scenario                                                                         | Tag  | Evidence                                                                                                                                                                                           | Status |
| -------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| a stale token on a still-DRAFT post is a conflict                                | unit | `CompletePostPublishingUseCase.test.ts:320-337`                                                                                                                                                    | PROVEN |
| a stale token on an already-PUBLISHED post is idempotent success, not a conflict | unit | `:339-364`; ordering in source at `CompletePostPublishingUseCase.ts:207-218`. Also `sagaPublishNowPromotion.test.ts:164` with `expectedVersion: 0`                                                 | PROVEN |
| a conflict is recoverable on the next attempt                                    | unit | **`:380-417`, the new case** — read sequence `[v7, v8]`, stale token to `CONFLICT` with 0 saves, then no token to `applied` at **version 9**, with `findById` 2 and `uow.calls` 2. Green in my run | PROVEN |
| the tokenless reused-draft path refuses an unpublishable post                    | unit | `:366-398` — `CANCELLED` and `PENDING_REVIEW` both `FORBIDDEN`. The W-C adjudication (a `FAILED` origin promotes) pinned at `:400-415`                                                             | PROVEN |

### R6 — the content-update command can no longer carry a status [MERGE-BLOCKING]

| Scenario                                                 | Tag    | Evidence                                                                                                                                                                                                | Status |
| -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| the field is gone from the schema                        | static | `packages/shared/src/cqrs.ts:204-217` — no `status`, `data` is `.strict()`. Runtime negatives at `PostCommandHandlers.update.test.ts:48-76`                                                             | PROVEN |
| the warn-and-drop branch is gone                         | static | `PostCommandHandlers.ts:216-227` — branch deleted, comment says why one cannot return; both negatives assert `executeCalls.length === 0`                                                                | PROVEN |
| no producer emits a status on the content-update command | static | Measured: `post.update` / `POST_COMMANDS.UPDATE_POST` appear 5 times, all consumers or declarations — **zero** production producers. The sole-producer claim was re-verified before the deletion (T3.7) | PROVEN |

### R7 — the persisted terminal status makes the re-publish guards effective [MERGE-BLOCKING]

| Scenario                                              | Tag         | Evidence                                                                                                                                                                                                                                     | Status |
| ----------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| a second start is rejected and enqueues nothing       | integration | `sagaPublishNowPromotion.test.ts:346-397` — first start 200 then COMPLETED, row `PUBLISHED`, queue count 1; second start is a 4xx matching `/PUBLISHED/` with the queue count **unchanged**, observed directly via `RecordingQueue.countFor` | PROVEN |
| the publish command refuses an already-published post | unit        | `PostCommandHandlers.publish.test.ts:77-95`, re-run green                                                                                                                                                                                    | PROVEN |

### R8 — the promotion runs in the saga's tenant scope, and refuses to run unscoped

| Scenario                                           | Tag         | Evidence                                                                                                                                                                                                                                                                                                          | Status                   |
| -------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| the promoting transaction is tenant-scoped         | integration | Scoped path succeeds under `withTenantContext`; unscoped is refused with nothing written (`:238-253`); **and the new cross-tenant case** (`:346-383`) seeds a second tenant via `seedForeignTenantPost` and proves its row and outbox are byte-identical across an in-tenant promotion. Write direction only — S5 | PROVEN (write direction) |
| an unresolvable tenant scope refuses the promotion | unit        | `CompletePostPublishingUseCase.test.ts:592-610` — classified into an error `Result`, zero saves, and `uow.resultErrors.length === 0` proves the throw did not become an `err` inside the seam                                                                                                                     | PROVEN                   |

### R9 — the saga step stays a thin emitter under the unchanged outcome contract

| Scenario                                         | Tag         | Evidence                                                                                                                                                                                                      | Status |
| ------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| the step no longer decides the status            | static      | The `newStatus` ternary is deleted; runtime at `sagaDeterministicIds.test.ts:215-224` asserts the emitted `data` carries neither `status` nor `publishedAt`                                                   | PROVEN |
| the command id is deterministic across attempts  | unit        | `sagaDeterministicIds.test.ts:131-144` — three executions, one distinct id                                                                                                                                    | PROVEN |
| a refused promotion is reported as a failed step | unit        | `:238-248`                                                                                                                                                                                                    | PROVEN |
| a scheduled or draft saga promotes nothing       | integration | `sagaPublishNowPromotion.test.ts:290-328`; the `draft`/`schedule` short-circuit at `saga.ts:991-993` is byte-identical to `origin/main` (diffed). Unit counterparts at `sagaDeterministicIds.test.ts:250-268` | PROVEN |

### R10 — the proof runs in CI, and the lock-in tests stop enshrining the defect [MERGE-BLOCKING]

| Scenario                                               | Tag    | Evidence                                                                                                                                                                                                                                                                                                                                      | Status |
| ------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| the new suite is wired exactly once                    | static | Measured: `grep -c` = **1**, inside `integration:saga-recovery` (`run-tests.sh:336-339`). Fitness #30 = **20** against the baseline of 21 — not risen. The harness and doubles are not `*.test.ts`                                                                                                                                            | PROVEN |
| the merge-blocking scenarios are RED before the change | static | Ten measured reds in `apply-progress.md`, plus three from this corrective: the `isPublished` short-circuit disabled gave "never terminalized: status=RUNNING step=4"; the OCC guard removed gave "the stale token is refused"; a memoized re-read gave `8 !== 9` and is caught **only** by the new C2 case. Every plant restored sha256-exact | PROVEN |
| no rewritten test asserts a fabricated version         | static | `PostCommandHandlers.update.test.ts:39-45` — assertion deleted, SMELL-119 named instead. `sagaDeterministicIds.test.ts:226-236` pins no forwarded token. The `version: 2` builder default is gone                                                                                                                                             | PROVEN |

**Totals**: 10 requirements, 32 scenarios (re-counted here from the native heading rule: 5, 2, 4, 3, 4,
3, 2, 2, 4, 3). **32 of 32 covered, 10 of 10 requirements satisfied.** One scenario (R2's first) is
satisfied in substance and short the PR-body artefact — W2.

---

## Design conformance (D1–D11) — unchanged from rev 1, re-confirmed

The corrective touched no source file, so every rev-1 conformance verdict stands. Summarised:

| #   | Decision                                                                 | As designed? | Anchor                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Pivot records `channelIds`; step decides totality fail-closed            | YES          | `saga.ts:789-819`; `readTotalPublishOutcome` at `:440-505`; nine refusals at `sagaDeterministicIds.test.ts:288-322`                                                                                                              |
| D2  | Tenant binding via `runAsSagaTenant`, no new primitive                   | YES          | `saga.ts:1002-1017`, whose comment correctly says the value does not itself scope the promotion                                                                                                                                  |
| D3  | Load once, transition twice, save once                                   | YES          | `CompletePostPublishingUseCase.ts:191`, `:230`, `:238`, `:249`; `version === 1` in the integration proof                                                                                                                         |
| D4  | The step forwards **no** token                                           | YES          | Pinned at `sagaDeterministicIds.test.ts:226-236`; the use case still honours a supplied token (`:211-218`), and C2's new case now proves recovery does not depend on one                                                         |
| D5  | `isPublished` gives `ok({applied:false})`, no save, no events            | YES          | `:207-209` plus `idempotentAnswer` at `:297-316`                                                                                                                                                                                 |
| D6  | New strict command; `status` removed and `data.strict()` on update       | YES          | `cqrs.ts:255-305` and `:204-217`; the ordering constraint held — D6 shipped with its producer rewrite                                                                                                                            |
| D7  | Resolve providers for the started event; unresolved never blocks         | YES, refined | `:326-347`; the apply-time move under `!post.isPublishing` (`:226`) with the DTO JSDoc at `:65-71` pinned by `:500-531`                                                                                                          |
| D8  | No `POST_PUBLISHED` CQRS event; audit only when applied; real version    | YES          | `PostCommandHandlers.ts:545`, `:551-570`, `:578-582`; asserted at `PostCommandHandlers.complete-publishing.test.ts:126-173`                                                                                                      |
| D9  | `PostPublishingStarted` stays internal                                   | YES          | Catalog entry deleted; `HANDLED_EVENT_TYPES` derives from the keys (`:57-59`); the outbox row still written; `EventSchemaRegistry.ts:145` keeps v1. No `post.publishing_started` remains in source except the negative assertion |
| D10 | `executeResultInTransaction` on the port; adapter via a private sentinel | YES          | `Repository.ts:183-205` (multi-line, the form fitness #4 requires); `PrismaUnitOfWork.ts:135-155`, no second `$transaction` (#40 Part A at its floor of 3)                                                                       |
| D11 | No `EventDispatcher` on the use case                                     | YES          | Constructor at `:110-114`; `setupPostUseCases.ts:122-134` passes none and says why; `clearDomainEvents()` at `:276`                                                                                                              |

**Guard order** matches the design exactly: invalid id (`:125`), empty channels (`:137`), non-total
(`:146`) before the transaction, each asserted with `uow.calls === 0`; then `findById` (`:191`),
`isPublished` (`:207`), `expectedVersion` (`:211`), providers under `!isPublishing` (`:226`),
`startPublishing` (`:230`), `markAsPublished` (`:238`), `save` with the two-way narrowing (`:249-262`),
`clearDomainEvents` (`:276`).

**The one deviation from the design text remains an improvement**: `save()` narrows on the exported
`VERSION_CONFLICT_CODE` rather than `instanceof`, because this package ships a dual conditional export
and two module copies would make class identity go false while every CAS conflict downgraded to
`INTERNAL_ERROR`. Pinned with a deliberately foreign error class at
`CompletePostPublishingUseCase.test.ts:554-577`.

---

## Signed decisions (Q1–Q5)

| Q   | Decision                                                                               | Honoured? | Evidence                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Synchronous command from the saga step; the event is an effect in the same transaction | YES       | The step emits `post.complete-publishing`; the handler delegates; the use case is the single writer; both events reach the outbox in the promoting transaction |
| Q2  | No schema migration                                                                    | YES       | The diff restricted to the Prisma infrastructure tree is **empty**, measured; the corrective adds nothing there either                                         |
| Q3  | No backfill                                                                            | YES       | No repair script anywhere in the committed or uncommitted set                                                                                                  |
| Q4  | Two-hop `DRAFT` to `PUBLISHING` to `PUBLISHED` in one UoW                              | YES       | Both hops inside one `executeResultInTransaction`; the FSM untouched; `PUBLISHING` never durable on the success path                                           |
| Q5  | Partial failure SPLIT to N-COR-2 — refused, never handled                              | YES       | `:146-153` returns `NOT_IMPLEMENTED` naming N-COR-2; the step refuses before emitting; `markAsFailed()` stays unwired                                          |

---

## Task completion

58 of 58 `[x]`, 0 unchecked. The two recorded deviations stand and are now joined by a third correction,
all three on the task row itself and not only in apply-progress:

- **T3.21** — the `sagaCustomerFlow` `PUBLISHED`-after-publish-now clause is unreachable in that tier
  (its fixture credentials cannot decrypt), so the tier's already-`PUBLISHED` case was strengthened
  instead; the direct job-count assertion lives in the CI-reachable tier per A7. Not faked, and said so.
- **T1.8** — the sweep gate was replaced after it was caught lying; the replacement is a set difference
  over files, measured at 53 definition sites across 52 files with residual gap 0.
- **T3.11** — now records **which half shipped when**: the direct re-execution half landed in the
  original apply, the redelivered-completion half did not and landed in the verify corrective. Rev 1
  flagged the row as overstating what shipped; it no longer does.

---

## Gates — every command run by me in this phase

| Gate                         | Command                                                                                                                                                                                                                                    | Exit  | Result                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (api, 6 touched suites) | `pnpm --dir apps/api exec vitest run <6 files>`                                                                                                                                                                                            | 0     | **6 files / 79 tests passed**                                                                                                                                                 |
| Unit (core posts)            | `pnpm --dir packages/core/posts exec vitest run`                                                                                                                                                                                           | 0     | **2 files / 27 tests passed** (was 26; the new C2 case named green in the verbose run)                                                                                        |
| **Integration**              | `integration:saga-recovery`, replicating `run-tests.sh:336-339` byte for byte — `node --conditions development --import tsx --test --test-reporter=tap --test-force-exit --test-concurrency=1 --test-timeout=120000` over the three suites | **0** | **33 tests / 33 pass / 0 fail / 0 cancelled / 0 skipped** (was 30; +2 for C1, +1 for the cross-tenant case). The promotion suite alone: 14/14, all eight describe blocks `ok` |
| Typecheck (api)              | `NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc --noEmit`                                                                                                                                                                            | 0     | clean — this is the envelope's build evidence (`turbo run typecheck` OOMs at exit 134 here)                                                                                   |
| Typecheck (core/posts)       | `pnpm exec tsc --noEmit`                                                                                                                                                                                                                   | 0     | clean                                                                                                                                                                         |
| Lint                         | `eslint --max-warnings 0` on the 3 changed test files                                                                                                                                                                                      | 0     | clean                                                                                                                                                                         |
| Format                       | `prettier --check` on all 31 changed non-`.sh` files (committed + uncommitted + this report)                                                                                                                                               | 0     | "All matched files use Prettier code style"                                                                                                                                   |

**On the envelope's `test_output_hash`**: it covers the unit capture, which is the run I could redirect to
a file. The integration batch needs the repository environment file loaded the way the runner loads it,
and the pre-bash gate refuses any command whose text names that file beside a write construct — so its
output could be piped and summarised but not captured for hashing. Its exit code and counts above are my
own observation from that run, not a record, and that distinction is the reason W1 is closed.

### Fitness (all re-measured after the corrective)

| #    | Subject                               | Count                                 | Expected                    |
| ---- | ------------------------------------- | ------------------------------------- | --------------------------- |
| 2    | core framework-free                   | 0                                     | 0                           |
| 3    | no `any` in core / api infrastructure | 0                                     | 0                           |
| 4    | no raw `throw` in core                | 0                                     | 0, exception list unchanged |
| 8    | no sprint/phase refs in comments      | 0                                     | 0                           |
| 9    | every file has `@file`                | 0                                     | 0                           |
| 10   | `@layer` values valid                 | 0                                     | 0                           |
| 30   | unreached test suites                 | **20**                                | baseline 21 — not risen     |
| 32   | committed `.skip` / `.only`           | 0                                     | 0                           |
| 40 A | transaction seam                      | 3 seam hits (floor 3), **0** non-seam | 0 non-seam                  |
| 40 B | derived GUC scope                     | 13 sites (floor 10), **0** underived  | 0 underived                 |

(#5, #6, #7, #21, #22 were 0 in rev 1 and are untouched by a test-only corrective.)

---

## Budget reconciliation

|                                           | Files  | Additions | Deletions | Total     |
| ----------------------------------------- | ------ | --------- | --------- | --------- |
| CODE (source), committed                  | 11     | 788       | 67        | **855**   |
| EVIDENCE, committed                       | 20     | 2,841     | 149       | 2,990     |
| EVIDENCE, verify corrective (uncommitted) | 7      | 399       | 15        | 414       |
| **EVIDENCE total**                        | **27** | **3,240** | **164**   | **3,404** |
| **Whole change**                          | **31** | **4,028** | **231**   | **4,259** |

**CODE is unchanged at 855** — verified, not assumed: no path in the uncommitted set falls outside
`tests/`, `docs/` and `openspec/`. The corrective's 414 evidence lines split as
`sagaPublishNowPromotion.test.ts` 131 · `apply-progress.md` 122 · `publishNowPromotionHarness.ts` 68 ·
`CompletePostPublishingUseCase.test.ts` 53 · `tasks.md` 28 · `design.md` 11 · the backlog row 1.

This report itself adds a further 506 lines when committed, and is excluded above for the same reason the
PR body is: it is the verification record, not the change's reviewable evidence.

EVIDENCE 3,404 against the ratified 2,000 stop — accepted by Edward on 2026-09-16, and the corrective
widened it to buy two merge-blocking proofs and a cross-tenant assertion. See W4.

---

## Residual and backlog register

| Residual                                                                                                                                                                                             | Named in                                                                                       | Verdict                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **D10 trade** (W-E): a deterministic JS-side save failure now fails the saga post-pivot with the post `DRAFT` while the provider holds it                                                            | `design.md` Residuals, PR-body draft, `apply-progress.md`                                      | YES — with the measurement that produced it                                                        |
| **W-C** adjudication: a `FAILED` origin promotes because the FSM governs                                                                                                                             | `design.md` Residuals, `tasks.md` T2.5, two unit cases, PR-body draft                          | YES — written **and** executable                                                                   |
| **SMELL-121** the promotion decrypts credentials it never reads and throws past the path designed to absorb it                                                                                       | `design.md` Residuals, `apply-progress.md`, backlog row with the throwing sites, PR-body draft | YES — see W6                                                                                       |
| **SMELL-122** `post.update` has zero production producers                                                                                                                                            | backlog row, PR-body draft                                                                     | YES — independently confirmed                                                                      |
| **SMELL-119** phantom `version: 2`, projected outward                                                                                                                                                | backlog row, **and a comment on the test line that used to pin it**                            | YES — the strongest placement                                                                      |
| **SMELL-120** `mediaIds` accepted and dropped                                                                                                                                                        | backlog row                                                                                    | YES                                                                                                |
| **SMELL-123** `PublishPostCommandHandler` naming                                                                                                                                                     | backlog row                                                                                    | YES                                                                                                |
| **SMELL-124** 8 type diagnostics in a committed test file that no typecheck program opens                                                                                                            | backlog row at `roadmap-detected-smells-backlog.md:177`                                        | YES — rev 1's W5, now closed                                                                       |
| R8's read-direction gap (the cross-tenant case proves non-mutation, not unreachability)                                                                                                              | the test's own comment at `sagaPublishNowPromotion.test.ts:346-352`                            | YES — S5                                                                                           |
| `turbo run typecheck` OOM (exit 134) in this LXC                                                                                                                                                     | `apply-progress.md`, PR-body draft                                                             | YES — reproduced here; direct `tsc` with a 6 GiB heap is clean                                     |
| B1–B9 (billing throws, the D10 caller class, D11 in-transaction dispatch, direct status writers, evicted job, lossy mapper, ADR number collision, Spanish UoW JSDoc, the refuted fitness-count line) | `tasks.md` Backlog and `design.md` Residuals                                                   | YES, except that B9's fitness-count line is now known false and still stated in two artifacts — S7 |

---

## Next

**`sdd-archive`**, once W2 is discharged — open the PR with the drafted body, which is the one artefact
R2 names that does not exist yet. Nothing else blocks. W4 and W6 are accepted and recorded; S3–S7 are
follow-ups that do not gate this change.
