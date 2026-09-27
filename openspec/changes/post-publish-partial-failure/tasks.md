# Tasks: post-publish-partial-failure (N-COR-8)

**Inputs (read in this order, all binding).** `pre-propose-decisions.md` (Q1–Q21 SIGNED by Edward —
constraints, never re-decided here) · `proposal.md` · the six specs under `specs/` · `design.md`
**rev 3.2** (authoritative on the PR chain; every deviation below cites the design line it departs
from and says why) · `research.md` / `explore.md` (evidence only) · canon: `CLAUDE.md` §Automated
Compliance Checks, `docs/architecture/ARCHITECTURE_CANON.md`, `docs/development/CODING_STANDARDS.md`,
`docs/security/SECURITY_CANON.md`, `docs/observability/LOGGING_CANON.md`.

**What this file is.** The ordered work breakdown and the MEASURED review-workload forecast. It
implements nothing and decides no product question. Language: English, neutral register.

**Counts measured in this pass** (not copied from the design's prose): **32 requirements /
140 scenarios** across six spec files — `post-channel-publication-record` 15/65,
`post-publication-retraction-alert` 6/22, `post-channel-publication-retry` 6/24,
`post-publish-status-promotion` 3/17, `saga-step-outcome-contract` 1/6, `multi-tenant-isolation` 1/6.
(design.md:3 says 65 and 21 for the first and second; the files as they stand hold 64 and 22. The
matrix below is built from the files, one row per requirement, every scenario accounted for.)

---

## 0 · Chain, blockers and the one thing that is not ready

### 0.1 · The PR chain (design.md:410-423, rev 3.2 — unchanged here)

```text
post-persistence-adapter-relocation   (prerequisite change — its OWN SDD; NOT tasked here)
        │
        ▼
      1b ──► {1b2, 1b3} ──► 1c ──► 1d ──► 1e ──► 2a ──► 2b
             (1b2 MUST precede 1c — D15.4, design.md:211)
```

| PR  | Boundary (design.md:415-422)                                                                                                                                                                                                      | Sound on `main` alone                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| —   | `post-persistence-adapter-relocation`                                                                                                                                                                                             | gated before 1b; VERIFIED + ARCHIVED before the tracker merges (D1, design.md:54-60; T0.1) |
| 1b  | schema + migration + #39 enrollment/red path; domain (predicates, `alertTransition`, all root methods, `derive()`, v1 payload builders, the two channel events); `savePublication` port + relocated adapter + doubles             | **Yes** — table empty, no writer                                                           |
| 1b2 | alert consumer: migration #2 (enum value, `RetractionAlertMedium`, `RetractionAlertDelivery` ledger), `isTypeEnabled`, media ports + 3 adapters, ledger adapter, 2 use cases, event handler, `SendEmailNotificationService` wired | **Yes** — inert until an event flows                                                       |
| 1b3 | `ThreadPublishFailure` contract across 6 `publishThread` implementors + `_template`; worker carries `publishedFragments` into its log and the `publish.job.failed` notification only                                              | **Yes** — additive, independent of 1b                                                      |
| 1c  | application use cases + CQRS; saga (id, wait, forwarder, pivot, scheduling step); `holder()` + 409; worker root-mediated write + CAS retry; confirm act + route (Q15); D18 env + sweep; Prometheus rule + runbook; C3 guards      | **Assembled: yes. Children: NO** — see 0.3                                                 |
| 1d  | read model + the four truth-reader repoints + unions/maps + the five DoD integration suites + `docs/api/saga.md` + ADR-0024                                                                                                       | **Yes**                                                                                    |
| 1e  | reconstruction script + test + runbook (rate-bounded)                                                                                                                                                                             | **Yes** — deploy step                                                                      |
| 2a  | explicit retry route (publish-now only) + 409 + double-submit proof                                                                                                                                                               | **Yes**                                                                                    |
| 2b  | customer per-channel panel + editor fix + admin parity + the new type's per-type toggle                                                                                                                                           | **Yes**                                                                                    |

### 0.2 · BLOCKER — the prerequisite change does not exist yet

Measured 2026-09-17: `openspec/changes/` holds ten changes and
**`post-persistence-adapter-relocation` is not one of them**; no `openspec/specs/` entry, no
`proposal.md`, no artifacts anywhere in the tree. PR **1b** cannot start: it edits
`packages/adapters/db-prisma/src/post/{PrismaPostRepository,PostAggregateMapper}.ts`, which the
prerequisite creates (D1, design.md:58). Recorded here as a hard edge, not a risk to manage:

- [ ] **T0.1** — Propose, apply, verify and ARCHIVE `post-persistence-adapter-relocation` (its own
      SDD, its own forecast, its own seven fitness red paths). Ratified 2026-09-17 (Edward, night
      slice): N-COR-8's `sdd-apply` may start once the relocation's apply has PASSED its
      fresh-context gate, by basing this change's tracker branch on the relocation branch (stacked);
      the relocation must be VERIFIED and ARCHIVED before the tracker merges to `main`, and a
      correction to the relocation rebases the tracker. Nothing in this file may be started against
      `apps/api/src/infrastructure/repositories/PrismaPostRepository.ts` as a workaround — that IS
      the relocation, renamed (design.md:60 rejects it explicitly).

What IS ready: N-COR-1 archived (`git log c23ec2c8`), its capability is promoted at
`openspec/specs/post-publish-status-promotion/spec.md`, and the three delta targets resolve — the two
headings this change RENAMES exist verbatim at `:119` and `:163`, R1's at `:37`;
`openspec/specs/saga-step-outcome-contract/spec.md:23` and
`openspec/specs/multi-tenant-isolation/spec.md:620` likewise. The archive step will match.

### 0.3 · The 1c coupling, stated once

1c's three natural children — **application** (use cases + CQRS + confirm route), **saga** (ids, wait
step, forwarder, pivot, lock read), **worker + sweep** (root-mediated write, CAS retry, classifier,
D18 sweep, alert rule, C3 guards) — are **individually unsound on `main`**. The reason is measurable,
not stylistic: `CompletePostPublishingUseCase`'s reconciliation refuses a post with no record
(design.md:170), so the application child alone would fail EVERY publish-now on `main`; and the saga
child alone reads a record nothing writes. They must land together. Under `feature-branch-chain` they
are children of a draft tracker that alone merges to `main`. **D15.5 (design.md:212) fixes one child
boundary: the confirm act, the sweep and the worker write stay in the SAME child**, so no commit on
`main` — or on the tracker tip — holds a strandable channel without its recorded exit.

Every other PR in the chain is sound alone and can be `stacked-to-main`.

**Chain strategy ratified 2026-09-17 (Edward): `feature-branch-chain`.** Tracker branch
`feature/post-publish-partial-failure`, based on the relocation branch until the relocation merges
(T0.1); every PR in §0.1 is a child targeting the previous child's branch (1b3 first, being
independent of 1b); only the tracker merges to `main`. Delivery strategy: `auto-chain`.

---

## 1 · PR 1b — the record, the domain, the narrow save

**Start state**: the relocation archived. **Finish state**: the table exists, empty; the domain can
compute every predicate and every word; the port and adapter can write a publication; nothing writes
one yet. **Rollback**: revert the range AND apply `down.sql` AND remove the `TENANT_SCOPED_MODELS`
entry + the guards-doc row — #39 fails closed if any one is left behind (proposal.md:150).

### WU 1b.A — schema, migration, enrollment, red path

- [ ] **T1b.1 RED** — `apps/api/tests/integration/postChannelPublicationTenantIsolation.test.ts`
      SKELETON only (the full suite lands in 1d): one case asserting the table exists and rejects a
      row whose `accountId` differs from its post's. Fails: no table. Registered in
      `run-tests.sh`'s `integration:tenant-isolation` batch (`apps/api/scripts/run-tests.sh:274-296`)
      — exactly once (#30).
- [ ] **T1b.2 GREEN** — `infra/prisma/schema.prisma`: model `PostChannelPublication` with the 24
      columns, 8 CHECKs, composite FK `(postId, accountId) → Post(id, accountId)` (the trio pattern,
      `schema.prisma:790`, `:812`), the `Account` relation (S3, design.md:80), `channelId` FK
      `NoAction`, `@@unique([postId, channelId])`, `@@index([channelId])`,
      `@@index([accountId, postId])`, the partial sweep index; enums `ChannelPublicationOutcome`,
      `ChannelExclusionReason`, `ChannelRetractionBlock`, `ChannelRetractionClearance`; three
      back-relations. **No `deletedAt`** (#38 untouched, design.md:98). Files: `schema.prisma` +
      `infra/prisma/migrations/<ts>_add_post_channel_publication/{migration,down}.sql` — timeouts
      first, canonical InitPlan-wrapped policy (`20260910000000_rls_initplan_post_trio:56-57`,
      `:63-71`), verbatim inverse down. **Schema edit and migration in ONE commit**
      (`rls-policy-form`). Run `pnpm db:up` first, then the migration — never skip it.
- [ ] **T1b.3 GREEN** — enrollment: `"postChannelPublication"` in `TENANT_SCOPED_MODELS`
      (`infra/prisma/src/extensions/tenantGuard.ts:91-153`) + the rows in
      `docs/security/MULTI_TENANT_GUARDS.md` (`:151`, `:1184-1192`). Fitness #39 back to 0.
- [ ] **T1b.4 RED PATH (mandatory, #39)** — plant the model unenrolled, run #39, observe a REAL
      non-zero exit naming `PostChannelPublication`, restore the tree sha256-exact, re-confirm 0.
      Transcript in the PR body. A gate whose red path was never demonstrated does not merge
      (CLAUDE.md §Extending the suite, step 3).

### WU 1b.B — value objects and the record entity

- [ ] **T1b.5 RED** — `packages/core/domain/tests/unit/channelPublication.test.ts`: the entity table
      from design.md:388 — budget 3, nontransient on attempt 1, unclassifiable bounded then named,
      monotonic `attempts`, `(episode, attemptNo)` idempotency, Q11 all-or-nothing (published with
      fewer fragments than `planSize` refused; failed with `publishedFragments` ⇒ `EXCLUDED` +
      `THREAD_INTERRUPTED` + `pendingRetraction` + `NO_CAPABILITY` + window opened + budget
      untouched), `hasLiveContent`/`redrivable`, `clearPendingRetraction`, `markRetractionOutcome`
      (partial ⇒ smaller set + `supersededAlertKey`; `exhausted` ⇒ window opens),
      `expireRetractionActionWindow({ now, window })` before/after `startedAt + window`, and
      `alertTransition()` over ALL FOUR clauses with clause 1's precedence.
- [ ] **T1b.6 GREEN** — `packages/core/domain/src/value-objects/{PublicationOutcome,ProviderReference,
FragmentReference,ExclusionReason,ContentFingerprint}.ts` and
      `packages/core/domain/src/entities/ChannelPublication.ts` per the interface block
      (design.md:313-324). `Result` only, no `throw` (#4); `@file`/`@description`/`@layer domain`
      headers (#9/#10); no phase refs (#8). Barrel exports in `value-objects/index.ts`.
- [ ] **T1b.7 RED→GREEN** — `packages/core/domain/tests/unit/channelPublications.derive.test.ts` then
      `packages/core/domain/src/aggregates/ChannelPublications.ts`: `derive()` total and
      order-independent over every combination (design.md:142 + D15.1), `hasLiveContent()`,
      `noLiveContent()`, `redrivable()`. The empty set has no derivation.

### WU 1b.C — the root

- [ ] **T1b.8 RED** — `packages/core/domain/tests/unit/postAggregate.publications.test.ts`: the S2
      five fixtures verbatim (design.md:121), the lock via the live-content predicate, `isEditable`
      no longer answering from the word, `ContentLockedError` distinct from
      `InvalidStateTransitionError`, W7 (each root method's effect on the word), the C2 edge table,
      Q10 fingerprint, and the **content-write door enumeration** (REC-6 `[static]`):
      `updateContent` / `addMedia` / `removeMedia` (`PostAggregate.ts:261-265`, `:554-592`) each
      refuse; `PrismaApproveVariantAdapter.ts:75-92` creates a NEW post; the seed is not production.
- [ ] **T1b.9 GREEN** — `packages/core/domain/src/aggregates/PostAggregate.ts`: `publications` in
      `PostAggregateState` (`:53-65`) and the seven root methods of D4 (design.md:104-110) +
      `assertPublicationProjection()` (design.md:119) + `isEditable` (`:252-254`) +
      `markAsPublished`/`markAsFailed` reshaped (`:399-451`);
      `packages/core/domain/src/value-objects/PublishStatus.ts` gains `PARTIALLY_PUBLISHED`, the
      `PARTIALLY_PUBLISHED → PUBLISHING` edge and the `noLiveContent()`-gated `FAILED` exits
      (design.md:131); `packages/core/domain/src/errors/ContentLockedError.ts`.
      **File-size watch**: `PostAggregate.ts` 619 → ~714. Inside the ≤800 exception band; seam if it
      crosses: `packages/core/domain/src/aggregates/post/PostPublicationMethods.ts`, a same-package
      companion the root alone calls (encapsulation preserved).

### WU 1b.D — events

- [ ] **T1b.10 RED→GREEN** — `packages/core/domain/src/events/PostEvents.ts`: `PostChannelPublished`
      and `PostChannelExcluded` (internal, registered v1); `PostPublished.toPayload()` and
      `PostPublishingFailed.toPayload()` rebuilt FROM THE RECORD, byte-equal to the v1 keys
      (design.md:190). Test asserts the exact key set and the values from the record and the joined
      provider (Q19). `INTEGRATION_EVENT_NAMES` is NOT touched.

### WU 1b.E — the narrow save (port + adapter + doubles, W-new-1)

- [ ] **T1b.11 RED** — extend `apps/api/tests/unit/infrastructure/PrismaPostRepository.test.ts` (824
      today): `savePublication` writes `status`/`publishedAt`/`version + 1` and the child upsert and
      the outbox, and NO content statement (`:712-727`) and NO media statement (`:729-773`); the
      **tripwire** refuses (`err`, `INVARIANT`) when a `PostContentUpdated` / `PostMediaAdded` /
      `PostMediaRemoved` event is pending (`:294-296`); the CAS returns `CONFLICT`.
- [ ] **T1b.12 GREEN** — `packages/core/domain/src/repositories/PostRepository.ts` gains
      `savePublication(post)`; `packages/adapters/db-prisma/src/post/PostAggregateMapper.ts` maps
      record rows ↔ `ChannelPublication` including `liveFragments` and the joined read-only
      `Channel.provider` (D3, design.md:98); `packages/adapters/db-prisma/src/post/
PrismaPostRepository.ts` gains the `findById` include and delegates every new statement to a
      **new** `packages/adapters/db-prisma/src/post/PostPublicationWrites.ts`.
      **File-size watch**: the repository ARRIVES at 903 lines from the prerequisite — already over
      the band before this change touches it. The split seam keeps its growth to ≤30 lines; the
      pre-existing oversize is a backlog row owned by the prerequisite (§7.3).
- [ ] **T1b.13 GREEN** — the ADR-0023 shape-agnostic `PostRepository` double used by the core unit
      tiers gains `savePublication` (compile-forced across every existing implementor).
- [ ] **T1b.14** — gates: `pnpm lint --max-warnings 0`, `tsc`, `prettier`, fitness #39 (0, red path
      proven), #2/#3/#4/#8/#9/#10/#23/#38 (floor 6 unchanged)/#40, `#30` (the skeleton suite named by
      exactly one `run_batch`).

---

## 2 · PR 1b2 — the retraction alert consumer (MUST precede 1c — D15.4)

**Start state**: 1b on the branch. **Finish state**: a `PostChannelRetractionAlertRaised` event that
nothing yet emits would be consumed, deduplicated per `(alertKey, medium, target)` and delivered
in-app + by email + to every active Slack/Teams config. **Rollback**: revert + `down.sql`; the enum
value stays (Postgres cannot drop one in place — design.md:196, named openly).

- [ ] **T1b2.1 RED** — `packages/core/notifications/tests/unit/isTypeEnabled.test.ts`: no row → true;
      row disabled → false. Fails: the predicate does not exist (it is inlined twice today,
      `CreateNotificationUseCase.ts:64-71`, `SendEmailNotificationService.ts:37-41`).
- [ ] **T1b2.2 GREEN** — `packages/core/notifications/src/isTypeEnabled.ts`; **both existing call
      sites refactored to call it** so the three cannot drift (design.md:229). Their own suites stay
      green unchanged — that is the regression proof.
- [ ] **T1b2.3 GREEN** — `packages/core/domain/src/value-objects/NotificationType.ts`:
      `PUBLICATION_RETRACTION_PENDING` (closed set 9 → 10) + `isUrgent()` as RANK only;
      `packages/core/notifications/src/SendEmailNotificationService.ts` `EMAIL_ENABLED_TYPES`
      (`:18-23`) admits it.
- [ ] **T1b2.4 GREEN** — `infra/prisma/schema.prisma` + `infra/prisma/migrations/
<ts>_add_retraction_alert_notifications/{migration,down}.sql`: `ALTER TYPE … ADD VALUE` (no row
      of that value written in the same migration), enum `RetractionAlertMedium`, table
      `RetractionAlertDelivery (id, alertKey, medium, target, notificationId?, deliveredAt)` with
      `@@unique([alertKey, medium, target])` + `@@index([alertKey])`. **`Notification` is NOT
      touched** (W-a-2, design.md:13). Timeout preamble first even though no policy is created. ONE
      commit. **#39 stays at zero without enrolling anything**: the ledger carries no `accountId`, so
      it is not a bearing model — the same class as `Notification` / `NotificationPreference`
      (design.md:196). Say so in the PR body; do not add it to `TENANT_SCOPED_MODELS`.
- [ ] **T1b2.5 RED** — `packages/core/notifications/tests/unit/raiseRetractionAlert.test.ts`: the
      full design.md:389 list — `typeOn` on BOTH per-member media; the **Q21 shared switch**
      (delivery with every member's row disabled, and again with ZERO recipients, once per active
      config per key; a DEACTIVATED config receives nothing while an active sibling does); the
      **three not-delivered reasons never collapsed** (`suppressed-by-preference` /
      `no-active-config` / `unavailable`); **ledger idempotency per medium** asserted as NUMBERS (two
      runs → one in-app row per enabled recipient, one email per enabled recipient, one webhook per
      config); superseded key resolved BEFORE the new claims; one medium's failure leaves the others
      and the record untouched. **No per-medium preference scenario exists** (rev 3.2).
- [ ] **T1b2.6 RED** — `.../resolveRetractionAlert.test.ts`: deletes exactly the notifications the
      ledger names, then the ledger rows, for every cause including `ACTION_WINDOW_EXPIRED`;
      idempotent.
- [ ] **T1b2.7 GREEN** — `packages/core/notifications/src/{RaiseRetractionAlertUseCase,
ResolveRetractionAlertUseCase}.ts` + barrel;
      `packages/core/domain/src/repositories/RetractionAlertDeliveryLedger.ts` (port, design.md:364);
      `packages/ports/src/RetractionAlertDeliveryPort.ts` (`AlertMedium`, `AlertMediumKind`,
      `RetractionAlertDelivery`, `AlertDeliveryResult`, `AlertDeliveryReport` — design.md:357-362).
- [ ] **T1b2.8 GREEN** — `packages/core/domain/src/repositories/ExternalNotifierPort.ts` gains
      `broadcast(projectId, event, payload, { toEveryActiveConfig })`; the method is PROMOTED from
      `ExternalNotificationDispatcher` (`:63-87`) to the port (S-r3-2).
- [ ] **T1b2.9 GREEN** — three adapters in the composition root: `InAppRetractionAlertDelivery`
      (→ `CreateNotificationUseCase` + `NotificationBroadcaster.broadcast`, `:126`),
      `EmailRetractionAlertDelivery` (→ `SendEmailNotificationService`, its FIRST production caller —
      SMELL-41's other half stays open), `SlackTeamsRetractionAlertDelivery` (→ the promoted
      `broadcast`, `toEveryActiveConfig: true`). `sms` / `push` have NO adapter and report
      `unavailable`.
- [ ] **T1b2.10 GREEN** — `apps/api/src/infrastructure/repositories/
PrismaRetractionAlertDeliveryLedger.ts` (`claim` returns `false` on P2002);
      `apps/api/src/notifications/RetractionAlertEventHandler.ts` (two event types, `accountId` from
      the outbox-reconstructed payload, `withTenantContext` — the `TriageDispatchEventHandler.ts:50`
      shape); registration in `apps/api/src/index.ts` beside `:839-845`; tokens in
      `infrastructure/container/{types,setupNotificationUseCases,setupExternalNotificationUseCases}.ts`;
      the two alert events registered v1 in `EventSchemaRegistry.ts`.
- [ ] **T1b2.11 GREEN** — `TransactionalEmailAdapter.renderNotification` case +
      `infrastructure/email/templates/emailTemplates.tsx`: post excerpt, channel, each fragment with
      its link, cause, action, deadline. No credentials, tokens or provider secrets (AL-2).
- [ ] **T1b2.12** — `apps/api/tests/unit/RetractionAlertEventHandler.test.ts` (tenant bound from the
      payload; ledger `claim` on P2002); `docs/api/notifications.md` (the new type, the ledger, the
      corrected `SendEmailNotificationService` path — the stale `:62` path is a backlog row); gates
      as T1b.14 plus #13/#14/#16.

---

## 3 · PR 1b3 — the thread contract (D16), independent of 1b

**Start state**: `main` (or the tracker). **Finish state**: every `publishThread` implementor returns
what went out on EVERY error path; the worker carries it into its log and its `publish.job.failed`
notification. No record is written here.

- [x] **T1b3.1 RED** — `packages/providers/x/tests/XAdapter.publish.test.ts`: rewrite the
      `THREAD_INTERRUPTED` case (`:183-207`) to assert
      `err({ code: "THREAD_INTERRUPTED", publishedFragments: [2 refs IN ORDER] })`; add mid-thread
      non-4xx → `NETWORK` with the same refs; first-fragment failure → `[]`. Fails today by LOSING
      the ids (measured: `XAdapter.ts:315-317` accumulates `publishedTweets`, `:355-378` discards it
      across four `err` sites at `:312`, `:370`, `:374`, `:377`).
- [x] **T1b3.2 GREEN** — `packages/shared/src/types.ts` `ThreadPublishFailure = { code: PublishError;
publishedFragments: ThreadReceipt["tweets"] }`; `packages/ports/src/ProviderAdapter.ts:152-155`
      re-typed. A compile error on every implementor is the point (design.md:216).
- [x] **T1b3.3 GREEN** — the six implementors, measured: `XAdapter.ts:301-379` (4 `err` sites; move
      the `publishedTweets` declaration above the credential check so `:312` returns `[]`
      explicitly); `InstagramAdapter.ts:447-509` (3 `err` sites, carousel is atomic ⇒ always `[]`);
      the four stubs `PinterestAdapter.ts:217-225`, `TelegramAdapter.ts:225-232`,
      `LinkedInAdapter.ts:216-224`, `SnapchatAdapter.ts:222-230` (1 `err` each ⇒ `[]`);
      `packages/providers/_template/src/index.ts:226`, `:294`.
- [x] **T1b3.4 RED→GREEN** — the five other provider suites: `TelegramAdapter.test.ts:366-384`
      rewritten (`THREAD_INTERRUPTED` with `[]`); Pinterest `:696-…`, LinkedIn `:895-…`, Snapchat
      `:543-…`, Instagram — each `result.error` assertion becomes `result.error.code` plus a
      `publishedFragments` assertion.
- [x] **T1b3.5 RED→GREEN** — `apps/workers/src/publishHandler.ts` (`:583-622`): the failure path
      carries `publishedFragments` into the tweet-row update loop and into the
      `notifySaga(publish.job.failed)` payload. NO record write yet (that is 1c). Worker unit suite
      asserts the ordering.
- [x] **T1b3.6** — gates; #32 (no `.only`/`.skip`), #9/#10 on every touched file.

---

## 4 · PR 1c — the coupled unit (application + saga + worker + sweep + confirm act)

**Start state**: 1b and 1b2 merged; 1b3 merged. **Finish state**: a partial publish produces a
durable per-channel record, a truthful derived word, a locked post, a forward-completing saga, an
urgent alert with an exit the customer can use, and a bounded action window. **Rollback**: revert the
whole tracker; the record and the tables survive (1b/1b2), unwritten.

**Child boundaries under `feature-branch-chain`** (0.3): `1c-1` application + CQRS · `1c-2` saga +
lock · `1c-3` worker + sweep + confirm act + alert rule + C3 guards. **D15.5: the confirm act, the
sweep and the worker write stay in `1c-3`.** Only the tracker merges to `main`.

### WU 1c.A — application use cases (child 1c-1)

- [ ] **T1c.1 RED** — `packages/core/posts/tests/unit/openPublicationEpisode.test.ts`: no records →
      declare then open; records + `noLiveContent()` → set replaced then opened; `hasLiveContent()` →
      the request set must EQUAL the recorded set else `VALIDATION_FAILED`, only `redrivable()`
      channels opened, a named pending-retraction channel refused `CHANNEL_HAS_LIVE_FRAGMENTS` WITH
      its fragments; `alreadyOpen: true` idempotency; `savePublication` used, never `save`.
- [ ] **T1c.2 RED** — `.../recordChannelPublicationAttempt.test.ts`: every `err` from inside the
      callback rolls back; CAS → `CONFLICT`; stale/zero episode → `CONFLICT`;
      `attemptNo ≤ episodeAttempts` → `applied: false` (PROM-R4 per channel); the W6 tripwire.
- [ ] **T1c.3 RED** — `.../confirmManualRetraction.test.ts` (clears with cause; 409 `NOTHING_PENDING`;
      `applied: false` on a duplicate; WORKS AFTER EXPIRY — Q17) and
      `.../expireRetractionActionWindow.test.ts` (passes the CALLER's `window` to the root; one
      `savePublication`; `applied: false` on the second call).
- [ ] **T1c.4 GREEN** — `packages/core/posts/src/{OpenPublicationEpisodeUseCase,
RecordChannelPublicationAttemptUseCase,ConfirmManualRetractionUseCase,
ExpireRetractionActionWindowUseCase}.ts` + barrel. All four: `executeResultInTransaction`
      (ADR-0023), `savePublication`, `Result` only, no own `$transaction` (#40).
- [ ] **T1c.5 RED→GREEN** — `CompletePostPublishingUseCase.ts`: delete the `NOT_IMPLEMENTED` refusal
      (`:146-153`), `resolveProviders` (`:326-347`) and `toProviderResults` (`:351-368`); become the
      reconciliation of design.md:170 — refuse before I/O on an empty set, `NOT_FOUND`, missing
      record (NAMED), channels outside the record, outcomes disagreeing with the record; then
      `reconcilePublicationProjection()` with `applied: false` on the happy path. Rewrite
      `packages/core/posts/tests/unit/CompletePostPublishingUseCase.test.ts` (691 today): zero saves
      on the happy path, no provider lookup, `publishedAt` never fabricated.
- [ ] **T1c.6 RED→GREEN** — `SchedulePostUseCase.ts` (`:139-151`, `:171-200`) calls
      `declarePublicationTargets` after `post.schedule()` and migrates to
      `executeResultInTransaction`. This is REC-1's `[static]` scenario: the validated identities are
      PERSISTED, not only returned in the DTO.
- [ ] **T1c.7 GREEN** — `packages/shared/src/cqrs.ts`: `POST_COMMANDS.OPEN_PUBLICATION_EPISODE` +
      `reasonCode` on the completion command (`:272-295` already admits `success: false` + `error`);
      `apps/api/src/cqrs/handlers/PostCommandHandlers.ts` + tokens in
      `infrastructure/container/{types,setupPostUseCases}.ts`. Handlers delegate to use cases, never
      to `prisma.*` (#6).

### WU 1c.B — the saga (child 1c-2)

- [ ] **T1c.8 RED** — rewrite `apps/api/tests/unit/sagaDeterministicIds.test.ts` (323 today) and add
      the wait-step table: `err` → `failed`; `undefined` or a set missing a scheduled channel →
      `failed` NAMING the missing record; any unresolved → `waiting`; else `succeeded` with
      `stepData.channels`. Plus: the forwarder forwards failures; the pivot rereads PER CHANNEL and
      refuses a pending-retraction channel; the dedupe key carries `-e{episode}`.
- [ ] **T1c.9 GREEN** — `packages/shared/src/saga.ts`: `readPublicationRecord` replaces
      `checkJobsStatus` in `createPostPublishingSagaDefinition` (`:1079-1091`);
      `WaitForPublishingCompletionStep` (`:850-951`) rewritten and the `failed > 0` branch (`:929-934`)
      and `getJobStates` DELETED; `UpdatePostStatusStep` (`:980-1062`) forwards the FULL outcome
      (`readTotalPublishOutcome` `:461-507` → `readPublishOutcome`, the `failed !== 0` refusal
      dropped); `SchedulePublishingJobsStep` (`:738-832`) issues `open-publication-episode` then one
      job per returned channel; `RereadCheck` (`:1094-1116`) per channel; `dedupeKey =
publish-${postId}-${channelId}-e${episode}` (replacing `SagaIntegration.ts:294`).
      **File-size watch**: `saga.ts` is 1227 lines BEFORE this change. Net ~+50. Splitting it
      (`packages/shared/src/saga/postPublishingSaga.ts`) would double 1c's diff for no behavioural
      gain — it is a NAMED BACKLOG ROW (§7.3), not work for this PR.
- [ ] **T1c.10 RED→GREEN** — `packages/ports/src/SemanticLockPort.ts` gains `holder(key)`;
      `RedisSemanticLockStore` answers it with `GET` (`:43`); NEW
      `apps/api/tests/unit/doubles/InMemorySemanticLockStore.ts` (Map-backed, four methods,
      `plantHolder`) and `RecordingLockStore` (`apps/api/tests/integration/sagaTenantIsolation.test.ts:126-141`)
      gains `holder()` — compile-forced (S-new-2).
- [ ] **T1c.11 RED→GREEN** — `apps/api/src/saga/SagaIntegration.ts` (`:283-345`, `:392-433`):
      publish-now admits a post with no record or ≥1 `redrivable()` channel and refuses 400
      otherwise; **schedule mode admits only `DRAFT`/`SCHEDULED`** (Q14 — publish-now is the only
      re-drive route); `holder()` non-null → **409 `{ code: "PUBLICATION_IN_FLIGHT", sagaId }`**;
      foreign channel still 404 (`:392-405`). **Split seam applied here**: the admission logic moves
      to a NEW `apps/api/src/saga/publishAdmission.ts` (SagaIntegration 895 → ~840 + 150 new).

### WU 1c.C — the worker, the confirm act, the sweep (child 1c-3 — D15.5)

- [ ] **T1c.12 RED** — `apps/workers/tests/*`: the classifier table (`RATE_LIMIT`/`NETWORK` transient;
      `AUTH`/`VALIDATION`/render nontransient; `THREAD_INTERRUPTED` nontransient;
      `PARENT_TWEET_FAILED` and unknown shapes unclassifiable); the thread failure path (tweet rows
      updated for the live fragments, the use case called with `publishedFragments` BEFORE
      `notifySaga`, NO rethrow when `EXCLUDED` — the provider double counts exactly ONE call); the
      skip path per record state; W4 (a job with no `accountId` or no episode → `UnrecoverableError`,
      nothing written); CAS exhaustion → the durable outcome job carrying the fragments; W9 (the
      mirror key with `-e{n}` stripped).
- [ ] **T1c.13 GREEN** — `apps/workers/src/security/workerTenantContext.ts` (new: `withWorkerTenant`,
      `getWorkerTenantContext`, no system context); `apps/workers/src/container/workerContainer.ts`
      (18 lines today) builds `workerGuardedPrisma` via
      `tenantGuardWithGucBindingExtension` (the `apps/api/src/infrastructure/container/setup.ts:74-77`
      shape), `PrismaOutboxWriter`, the relocated `PrismaPostRepository` / `PrismaUnitOfWork` with the
      worker provider, and the two `@core/posts` use cases; `apps/workers/package.json` gains
      `@core/posts`. **Composition root per executable** — the shared core is not duplicated
      (ARCHITECTURE_CANON §Dependency Injection).
- [ ] **T1c.14 GREEN** — NEW `apps/workers/src/lib/classifyPublishFailure.ts`; NEW
      `apps/workers/src/publishOutcomeRecorder.ts` (the record write + the CAS retry — 8 tries, full
      jitter, 25 ms base doubling to a 400 ms cap, **1.975 s worst case** inside the consumer's 60 s
      `lockDuration` — + the durable `record-publication-outcome` job + the DLQ path with
      `worker_publish_outcome_unrecorded_total`); `apps/workers/src/publishHandler.ts` — skip path
      (`:733-739`) reads the RECORD and notifies, W4 deletions (`resolveJobAccountId` `:123-146`,
      `recordTenantScopeFailure` `:159`, the `publishJobAccountIdSource` metric), D10 (`RUNNING`/`ERR`
      writes at `:795-806`, `:331-344`, `:285-294`, `:585-596` removed; ONE `OK` receipt after the
      record commits); `publishHandlerTypes.ts:152` loses its `?` on `accountId`.
      **File-size watch**: `publishHandler.ts` 867 → ~837 thanks to the two extractions; still over
      the band pre-existing — backlog row (§7.3). **Rule, tested**: after a successful provider call
      the worker NEVER re-runs the provider call because the RECORD write failed.
- [ ] **T1c.15 RED→GREEN** — the confirm act (Q15, D15.5): NEW
      `apps/api/src/posts/postChannelRoutes.ts` with
      `POST /posts/:postId/channels/:channelId/retraction/confirm-removed` (no body) →
      `ConfirmManualRetractionUseCase`; 404 for a channel outside the recorded set, 409
      `NOTHING_PENDING`, idempotent on a duplicate submit. Registered from `postRoutes.ts` (702
      today, +6). **The new file is the seam 2a's retry route lands in** — both routes stay under the
      band. Unit suite `apps/api/tests/unit/postChannelRoutes.confirm.test.ts` (404/409/200).
- [ ] **T1c.16 RED→GREEN** — D18: `RETRACTION_ACTION_WINDOW_HOURS` in the `server` block of
      `apps/api/src/config/env.ts` (the `SAGA_WAIT_POLL_MS` shape, `:309`; `int().min(1).max(720)
.default(72)`) — read ONLY through `env`, ONLY in `apps/api` (#16); `.env.example`,
      `.env.test.example`, `docs/deployment/ENVIRONMENT_VARIABLES.md`; NEW
      `apps/api/src/infrastructure/retention/RetractionActionWindowSweep.ts` registered in
      `apps/api/src/index.ts` beside the deletion-record degrader (`:950-962`) through
      `BackgroundTaskScheduler` at 15 min (**no raw `setInterval` — #11**), discovery under
      `withSystemContext` via a NEW `PendingRetractionSweepReader` port +
      `packages/adapters/db-prisma/src/PendingRetractionSweepReads.ts` (limit 100, oldest first, over
      the partial index), per-row `withTenantContext` → `ExpireRetractionActionWindowUseCase`; the
      tick summary AWAITED and logged; metrics `retraction_action_window_expired_total` and
      `retraction_action_window_sweep_failures_total`. Unit suite
      `apps/api/tests/unit/RetractionActionWindowSweep.test.ts` incl. **S-a-4** (a failing row is
      counted and does not stop the tick).
- [ ] **T1c.17 RED→GREEN** — **C3 guards (W-new-2)**, in the PR where the materialized word goes live:
      `apps/api/src/admin/SchedulingPostHandlers.ts` — `reschedulePost` (`:327-360`) re-reads INSIDE
      its `withGucBoundTransaction` with `channelPublications`, refuses 409 when `hasLiveContent()`,
      and its `update` takes `where: { id, status: { in: ["SCHEDULED","DRAFT","FAILED"] } }` (the
      fitness **#41** compare-and-swap shape); `cancelScheduledPost` (`:241-260`) the same. Unit
      suites `apps/api/tests/unit/SchedulingPostHandlers.*.test.ts`.
- [ ] **T1c.18 GREEN + RED PATH** — `prometheus/alerts/publish-record.yml` rule
      `PublishOutcomeUnrecorded` (`expr: increase(worker_publish_outcome_unrecorded_total[10m]) > 0`,
      `for: 1m`, `severity: critical`, `component: publish`) copied from `PublishQueueUnattended`'s
      shape (`prometheus/alerts/saga.yml:158-168`) + runbook
      `docs/runbooks/alert-publish-outcome-unrecorded.md`. **Red path: `promtool test rules`** proves
      the rule fires and does not fire, restore-exact (S-r3-1).
- [ ] **T1c.19** — gates: lint/tsc/prettier 0/0; #1/#2/#3/#4/#6/#7/#8/#9/#10/#11/#16/#21/#22/#23/#32/
      #40 Part A+B/#41 at 0; #30 and #38's db-prisma ratchet not risen; `pnpm db:up` before every
      integration run.

---

## 5 · PR 1d — read model, truth-reader repoints, the DoD suites, ADR-0024

**Start state**: 1c merged. **Finish state**: every reader answers from the record, "Partially
Posted" renders, and the five DoD integration suites are in CI. **Rollback**: code-only.

- [ ] **T1d.1 GREEN** — `packages/core/domain/src/repositories/PostRepository.ts` `PostReadModel`
      (`:184-198`) gains `channelPublications: ChannelPublicationView[]` (design.md:200);
      `apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts` include +
      `getRecentlyPublished` (`:341-363`) + top-performers (`:339-352`).
- [ ] **T1d.2 GREEN** — truth-reader repoints (D10, design.md:184): `SchedulingPostHandlers.ts:98-125`
      and `:166-184` (include → `channelPublications`), `providers/providerService.ts:189-206`,
      `projects/projectRoutes.ts:351`, `:377-385`, `packages/monitoring/health-checks/src/
tenantHealth.ts:433-436` via a NEW `RepoPort.listRecentChannelPublications({ since, limit })` +
      `packages/adapters/db-prisma/src/ChannelPublicationReads.ts`.
- [ ] **T1d.3 GREEN** — the seven status unions (`apps/client/lib/api/types.ts:35`,
      `lib/api/clients/postsClient.ts:13`, `apps/api/src/posts/postsService.ts:16`, `:139`,
      `cqrs/handlers/PostQueryGetList.ts:51`, `:196`, `PostQuerySearchAnalytics.ts:43`,
      `admin/schedulingSchemas.ts:15`, `posts/postRoutes.ts:71`) and the six UI maps
      (`PostCard.tsx:44-52`, `PostsFilters.tsx:35-37`, `posts/[id]/page.tsx:224-239`,
      `preview/page.tsx:182-184`, `dashboard/page.tsx:62`, `useSchedulingDashboard.ts:94-100`) gain
      `PARTIALLY_PUBLISHED` / "Partially Posted"; the dashboard tile counts `publishedAt != null`;
      `apps/client/types/scheduling.ts`.
- [ ] **T1d.4 `[static]`** — enumerate every production reader of publication truth and show none
      reads `PublishLog` (REC-13). Record the enumeration in the PR body; the two N-COR-9-deferred
      correlation readers (`snapchatWebhookProcessor.ts:191-197`,
      `facebookWebhookProcessor.ts:402-418`) are NOT truth readers and are named as such.
- [ ] **T1d.5 RED→GREEN** — `apps/api/tests/integration/sagaPartialPublishRecord.test.ts` on the
      promotion harness: the 13 cases of design.md:393 verbatim, incl. (11) the single-channel thread
      with ONE live reference, `pendingRetraction`, `actionWindowStartedAt` set, row `FAILED`, ONE
      `PostPublishingFailed` outbox row with the v1 keys, `/start` refused NAMING the fragment, and
      exactly ONE `PostChannelRetractionAlertRaised` outbox row IN THE SAME TRANSACTION.
      Batch: `integration:saga-recovery` (`run-tests.sh:336-339`), `CONCURRENCY=1`.
- [ ] **T1d.6 RED→GREEN** — `retractionAlert.test.ts` (own batch): the alert spec's Slack/Teams
      `[integration]` scenario EXACTLY — two ACTIVE configs whose `events` filters do not name the
      type AND no member with the type enabled → both delivered; plus per-member delivery, the
      ledger row per `(alertKey, medium, target)`, redelivery changing no count, resolve removing
      notifications and ledger rows, a throwing mailer leaving the in-app rows and the record intact,
      and `Notification`'s table shape UNCHANGED.
- [ ] **T1d.7 RED→GREEN** — `retractionActionWindow.test.ts` (own batch): two tenants, one tick
      expires only A's, written under A's GUC (a planted mismatched tenant refused by RLS);
      `ACTION_WINDOW_EXPIRED`; fragments held; content update refused; resolve row ONCE; a second
      tick writes nothing; a planted always-failing row counted every tick while a younger expired
      row still expires (S-a-4); a partial retraction after expiry raises nothing; confirm-removed
      after expiry clears and unlocks. **Expiry is driven from a controllable clock, never by
      sleeping** (alert spec's verification note).
- [ ] **T1d.8 RED→GREEN** — `postChannelPublicationTenantIsolation.test.ts` completed from T1b.1's
      skeleton (cross-tenant read returns nothing; `accountId == post.accountId`; foreign
      `channelId`/`postId` → 404 and zero rows; the worker-path write bound to the job's tenant).
      Batch `integration:tenant-isolation`.
- [ ] **T1d.9 `[static]`** — the `pg_catalog` RLS coverage gate
      (`rls-tenant-isolation.test.ts` → `describe("pg_catalog coverage gate")`) covers the new table
      BY CONSTRUCTION because it enumerates `getTenantScopedModels()`. Confirm green; no new test.
- [ ] **T1d.10 GREEN** — `apps/api/scripts/run-tests.sh`: each new suite named by **exactly one**
      `run_batch` (#30) — two appended to existing batches (T1d.5, T1d.8), two new batches (T1d.6,
      T1d.7). The #30 ratchet baseline of 21 must not rise.
- [ ] **T1d.11 DOCS** — `docs/technical/ADR-0024-post-channel-publication-record.md` from the outline
      at design.md:443-445 (**0024 verified free**: `docs/technical/` holds 0020 ×2, 0021, 0022,
      0023); `docs/api/saga.md:278-288`; `docs/development/saga-test-suites.md` rows.
- [ ] **T1d.12** — gates as T1c.19 plus #12 (`@component` on any touched component) and #26 (no
      `.js`-on-`.ts` relative imports in the frontend dirs).

---

## 6 · PR 1e — the deploy step (W5)

**Deploy order is not negotiable: migrate → deploy → run 1e, inside the announced maintenance
window** (design.md:408). The hazard it answers is HIGH and already measured: every scheduled post's
job sits in the BullMQ delayed set with a saga ALREADY `COMPLETED`, so post-deploy each fires against
a post with no record and dies `UnrecoverableError` while the post silently rests `SCHEDULED`.

- [ ] **T1e.1 RED** — `apps/api/tests/integration/publicationRecordReconstruction.test.ts` (own
      batch): reconstruction from the saga row; no-op on a post that already has records.
- [ ] **T1e.2 GREEN** — `scripts/migrations/<ts>-reconstruct-publication-records.ts` carrying
      `// canon-exception: migration:<ts>` (the directory does not exist yet — this change creates
      it). For every `SagaInstance` with `definitionId = "post-publishing-saga"`, `status =
COMPLETED`, `metadata.mode = "schedule"` whose post reads `SCHEDULED`/`DRAFT` with no records:
      bound to the saga's tenant (`SagaIntegration.ts:465`), `declarePublicationTargets(channelIds)` + `openPublicationEpisode({ enterPublishing: false })` THROUGH the use cases, remove the legacy
      delayed jobs by id, enqueue `publish-{p}-{c}-e1` at `runAt = scheduledAt` with `accountId`.
      **Rate-bounded: ≤20 jobs/second (50 ms pause, `--rate` overridable)** — W-new-4.
- [ ] **T1e.3 DOCS** — `docs/deployment/publication-record-reconstruction.md`: the order, the
      maintenance window, the burst line (a backlog of N overdue posts reaches the providers over
      N/20 seconds), what to watch (`PublishQueueUnattended`, provider rate-limit counters), and the
      acceptance check — `worker_publish_job_unrecoverable_total{reason="pre_change_job"}` reads zero
      afterwards.
- [ ] **T1e.4** — `run-tests.sh` batch (once); gates.

---

## 7 · Slice 2 and the ledger of what this change owes

### 7.1 · PR 2a — the explicit retry

- [ ] **T2a.1 RED** — `apps/api/tests/integration/postChannelRetry.test.ts` (own batch): a double
      submit produces EXACTLY ONE provider call and one recorded outcome with the attempt count
      advanced by one (the dangerous red — on a tree without the deterministic identity it fails by
      PUBLISHING TWICE); a channel that published in the meantime is not re-sent; a retry with
      nothing to do → client error, zero jobs; a pending-retraction channel → 409
      `CHANNEL_HAS_LIVE_FRAGMENTS` naming the fragments and the manual action.
- [ ] **T2a.2 RED** — unit: a retry naming an untargeted channel → client error, no record created;
      a retry carrying a future time is refused or acts now, and creates no scheduled work (Q14).
- [ ] **T2a.3 GREEN** — `POST /posts/:postId/channels/:channelId/retry` in the EXISTING
      `apps/api/src/posts/postChannelRoutes.ts` (created in 1c) — **no body, no time argument** —
      after the `holder()` 409 check, starting the same saga with `mode: publish-now`,
      `channelIds: [channelId]`. Re-inclusion IS the episode opening (Q8); content untouched (Q3).
      `[static]`: fitness **#7** measures zero — the identity is `(postId, channelId, episode)`,
      never `randomUUID`.
- [ ] **T2a.4** — duplicate suppression is OBSERVABLE (answerable as suppressed, not silently
      identical to work that ran) — RT-2's last clause.
- [ ] **T2a.5** — gates; `run-tests.sh` batch once.

### 7.2 · PR 2b — the customer panel and parity

- [ ] **T2b.1 RED** — component tests (frontend vitest tier): the panel renders EXACTLY three shapes
      (published with references, in progress, failed with reason + retry) plus the
      pending-retraction variant (live fragments with links, the manual action, the window state,
      **no retry affordance**, the confirm-removed action); **no shape can draw a "partially
      published channel"**; "Partially Posted" renders on every status surface with no
      unknown-status fall-through.
- [ ] **T2b.2 GREEN** — the panel component (new file — keeps `posts/[id]/page.tsx` at 597 + ~20
      rather than +320) + the confirm button wired to 1c's route.
- [ ] **T2b.3 RED→GREEN** — the editor stops re-seeding a default selection over a post with a
      published channel (`computeDefaultChannelSelection`, `posts/[id]/page.tsx:77-86`, `:440-444`);
      a submission presenting a different channel set does not silently replace the recorded set and
      the response NAMES the refusal.
- [ ] **T2b.4 GREEN** — admin parity levelled UP: the admin per-channel view answers from the record
      (RT-5 `[static]`: both sides inspected, neither answers publication questions from
      `PublishLog`).
- [ ] **T2b.5 GREEN** — the new type appears as one more toggle in
      `apps/client/components/notifications/NotificationPreferences.tsx` (per `docs/api/
notifications.md:96-104`). **No per-medium control** — that is
      `customer-notification-policy`'s (rev 3.2).
- [ ] **T2b.6** — `@component` JSDoc on every new component (#12); #26; gates.

### 7.3 · Docs, Master Plan and backlog rows this change OWES

- [ ] **T7.1** — `docs/product/MASTER_PLAN_ES.md` (399 lines): update the **N-COR-8** ficha + §6
      dashboard with PR numbers and merge shas, and CREATE rows for the successors that have no
      number yet — **`post-persistence-adapter-relocation`** (prerequisite), **`customer-notification-policy`**,
      **the SMS change**, **`integration-events-v2`**, and **push** (no owning change; waits on a
      mobile API). N-COR-9 and N-COR-10 already have labels; link them to this change's seams (D5's
      window, D16's seam). Delivered as a docs-only micro-PR to `main` at cluster close.
- [ ] **T7.2** — `docs/reports/roadmap-detected-smells-backlog.md` (229 lines) — the rows this change
      names and does not absorb:
      W4's fail-closed mapper · N-COR-1 W1's direct status writers (incl. episode withdrawal) ·
      SMELL-41's remaining half (`SendEmailNotificationService` for the other four types;
      `NotificationEventHandlers` unwired) · the per-medium model for every type (→
      `customer-notification-policy`) · per-provider thread resume (§2F) · the D11-class in-process
      dispatch (`SchedulePostUseCase.ts:187`) · `PostPublishedEventSchema` /
      `PostPublishFailedEventSchema` deletion + the `providerResults` rename (→
      `integration-events-v2`) · `incrementPostPublished()` at schedule time
      (`SchedulePostUseCase.ts:192`, Q1) · the cross-post duplicate guard on `contentHash` (Q10) ·
      delete/archive of a post live on providers + the `PublishLog` model verdicts (Q6) · the stale
      `docs/api/notifications.md:62` path · the ADR-0020 number collision · **cancel/reschedule do
      not stop the delayed job** (pre-existing, design.md:146) · **four oversize files this change
      does not split**: `packages/shared/src/saga.ts` (1227), `apps/api/src/index.ts` (1341),
      `packages/adapters/db-prisma/src/post/PrismaPostRepository.ts` (903, arrives that way from the
      prerequisite), `apps/workers/src/publishHandler.ts` (867 → ~837).

---

## 8 · Requirement → Task matrix

Every requirement of all six spec files, with its scenario count and the task that carries it.
`[static]` scenarios name what decides them.

### `post-channel-publication-record` (15 requirements / 65 scenarios)

| #      | Requirement                                        | Scn | Tasks                              | `[static]` decided by                                                                                                                                                                                                 |
| ------ | -------------------------------------------------- | --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REC-1  | Intended target set RECORDED at schedule           | 4   | T1c.6, T1d.5, T1d.8                | "schedule path no longer discards" → inspect `SchedulePostUseCase.ts:139-151`, `:194-199` (T1c.6)                                                                                                                     |
| REC-2  | One record per (post, channel), root-only writes   | 4   | T1b.2, T1b.9, T1b.12, T1c.13       | "no production writer bypasses the root" → enumerate writers of the `postChannelPublication` accessor in production source (T1d.4 PR body); "keys by channel, derives the provider" → schema + mapper (T1b.2, T1b.12) |
| REC-3  | Outcome, reason, attempt count                     | 4   | T1b.5, T1b.6, T1d.5                | —                                                                                                                                                                                                                     |
| REC-4  | ALL-OR-NOTHING across fragments                    | 5   | T1b.5, T1b3.1-.5, T1c.12, T1d.5    | —                                                                                                                                                                                                                     |
| REC-5  | Live fragments pending retraction = explicit state | 5   | T1b.5, T1b.6, T1c.3, T1c.15, T1d.7 | —                                                                                                                                                                                                                     |
| REC-6  | Content LOCKS on live content, no window           | 5   | T1b.8, T1b.9, T1d.5                | "every content-write path refuses" → the enumerated door list in T1b.8                                                                                                                                                |
| REC-7  | Status is a PURE FUNCTION of the record            | 7   | T1b.7, T1b.9, T1d.1, T1d.5         | —                                                                                                                                                                                                                     |
| REC-8  | `PARTIALLY_PUBLISHED` RESTS                        | 3   | T1b.9, T1c.1, T1d.5                | —                                                                                                                                                                                                                     |
| REC-9  | Wait step reads the RECORD                         | 5   | T1c.8, T1c.9, T1d.5                | —                                                                                                                                                                                                                     |
| REC-10 | Bounded per-channel budget, transient split        | 5   | T1b.5, T1c.14, T1d.5               | —                                                                                                                                                                                                                     |
| REC-11 | Post + records + outbox ALL-OR-NOTHING             | 3   | T1b.11, T1c.4, T1d.5               | "Result-aware seam, no own transaction" → fitness #40 Part A+B + inspection (T1c.19)                                                                                                                                  |
| REC-12 | Re-drive schedules ONLY unpublished channels       | 6   | T1c.9, T1c.11, T1c.14, T1d.5       | —                                                                                                                                                                                                                     |
| REC-13 | Record is the SOLE truth; absence FAILS CLOSED     | 3   | T1c.5, T1c.8, T1d.2                | "no truth consumer reads `PublishLog`" → the T1d.4 enumeration                                                                                                                                                        |
| REC-14 | Tenant-isolated by construction                    | 4   | T1b.2, T1b.3, T1d.8, T1d.9         | "enrolled and row-secured" → #39 at 0 + the `pg_catalog` gate (T1b.3, T1d.9); "the unenrolled model is caught" → the #39 RED PATH (T1b.4)                                                                             |
| REC-15 | Published record carries the CONTENT FINGERPRINT   | 2   | T1b.6, T1b.8                       | —                                                                                                                                                                                                                     |

### `post-publication-retraction-alert` (6 / 22)

| #    | Requirement                                                             | Scn | Tasks                                                     |
| ---- | ----------------------------------------------------------------------- | --- | --------------------------------------------------------- |
| AL-1 | A stranded channel raises an URGENT alert                               | 3   | T1b.5 (`alertTransition`), T1b2.5, T1d.5 (case 11), T1d.6 |
| AL-2 | The alert NAMES post, channel, fragments, action                        | 2   | T1b2.7, T1b2.11, T1d.6                                    |
| AL-3 | Delivery on every medium the customer chose, EQUAL terms                | 7   | T1b2.1-.3, T1b2.5, T1b2.9, T1d.6                          |
| AL-4 | Action window app-parametrized; expiry closes the ALERT, never the LOCK | 3   | T1b.5, T1c.3, T1c.16, T1d.7                               |
| AL-5 | Deduplicated per (post, channel), re-sent only on CHANGE                | 4   | T1b.5 (`alertTransition` 4 clauses), T1b2.5, T1d.6        |
| AL-6 | Rides the outbox; internal consumers only (Q19)                         | 3   | T1b.10, T1b2.10, T1d.5 (case 11), T1d.6                   |

### `post-channel-publication-retry` (6 / 24)

| #    | Requirement                                               | Scn | Tasks                             | `[static]` decided by                                                                                                                                                                              |
| ---- | --------------------------------------------------------- | --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RT-1 | Channel-scoped retry acts ONLY on unpublished channels    | 6   | T2a.1-.3                          | —                                                                                                                                                                                                  |
| RT-2 | IDEMPOTENT under double submit — one provider call        | 4   | T1c.9 (episode id), T2a.1, T2a.4  | "no generated identifier in a dedupe key" → fitness **#7** at 0 (T2a.3)                                                                                                                            |
| RT-3 | An excluded channel is RE-INCLUDABLE, same locked content | 5   | T1c.1, T1d.5 (cases 2, 13), T2a.1 | —                                                                                                                                                                                                  |
| RT-4 | The CONFIRM act ships in the SAME window as the state     | 3   | T1c.15 (+ T1c.3, T1c.4)           | "the exit ships with the state" → the merge order itself: the confirm route + use case are in **1c-3**, the same child as the worker write (D15.5). Decided by inspecting the chain, not by a test |
| RT-5 | The customer SEES every channel's outcome and affordance  | 4   | T1d.1, T1d.3, T2b.1, T2b.2        | "both sides answer from the record" → inspect the admin + customer read paths (T1d.2, T2b.4)                                                                                                       |
| RT-6 | The editor does not re-seed a default selection           | 2   | T2b.3                             | —                                                                                                                                                                                                  |

### `post-publish-status-promotion` delta (3 / 17) — MODIFIED, two also RENAMED

| #       | Requirement (new heading)                                                    | Scn | Tasks                                | Archive note                                                                                                                                                                                                                                                                                                              |
| ------- | ---------------------------------------------------------------------------- | --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PROM-R1 | A total-success publish-now reaches PUBLISHED … in one transaction           | 6   | T1b.11, T1c.4, T1c.5, T1d.5 (case 3) | heading UNCHANGED — matches `openspec/specs/post-publish-status-promotion/spec.md:37`. `[static]`: "through the aggregate, not a field write" → inspect the promotion use case (T1c.5); "the previously dead promotion path is live" → `startPublishing` / `markAsPublished` each have a production caller (T1c.5, T1c.9) |
| PROM-R3 | The command carries the publish outcome, and a NON-TOTAL outcome is RECORDED | 6   | T1c.5, T1c.9, T1d.5 (cases 1, 6)     | **RENAMED** from "… and anything short of total success is REFUSED" — the old heading is verbatim at `:119`. `[static]`: "the NOT_IMPLEMENTED seam is gone" (T1c.5); "the outcome is observable at the moment it is built" → the scheduling step records the identities it enqueued (T1c.9)                               |
| PROM-R4 | Re-application is idempotent — per post AND per channel                      | 5   | T1c.2, T1c.5, T1d.5 (cases 2, 7)     | **RENAMED** from "… an already-PUBLISHED post succeeds without a second event" — verbatim at `:163`                                                                                                                                                                                                                       |

The other seven requirements of that capability are REUSED verbatim and must stay green —
`sagaPublishNowPromotion.test.ts` (437 lines) is a regression gate for this change, not a rewrite
target.

### `saga-step-outcome-contract` delta (1 / 6)

| #    | Requirement                                                                   | Scn | Tasks                                                                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SG-1 | A step outcome is exactly one of THREE states (wait-step clause re-specified) | 6   | T1c.8, T1c.9, T1d.5 (cases 1, 4, 6). Heading verbatim at `openspec/specs/saga-step-outcome-contract/spec.md:23`; the union itself is unchanged, so the other four requirements of that capability stay reused |

### `multi-tenant-isolation` delta (1 / 6)

| #    | Requirement                                                        | Scn | Tasks                                                                                                                                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MT-1 | Create paths validate parent ownership per enrolled model (+1 row) | 6   | T1b.2, T1b.3, T1c.6, T1c.11, T1c.13, T1d.8. Heading verbatim at `openspec/specs/multi-tenant-isolation/spec.md:620`; the new row identifies the model by what it IS, and the design fixes the name `PostChannelPublication` (D3). Four of the six scenarios are the living spec's existing ones and stay green |

---

## 9 · Review Workload Forecast — MEASURED

**Method, stated so it can be checked.** The N-COR-1 forecast was wrong twice because it
extrapolated. Every line below is sized against a **comparable existing file that was opened and
counted in this pass**, with that file's line count cited. Test volume uses this repo's own measured
EVIDENCE:CODE ratios from PAIRED files rather than a flat multiplier:

| Paired files (measured)                             | CODE | EVIDENCE | ratio |
| --------------------------------------------------- | ---- | -------- | ----- |
| `ShortCode.ts` / `ShortCode.test.ts`                | 110  | 112      | 1.02× |
| `UTMParameters.ts` / `UTMParameters.test.ts`        | 150  | 143      | 0.95× |
| `EmailAddress.ts` / `EmailAddress.test.ts`          | 49   | 79       | 1.61× |
| `ScheduledTime.ts` / `ScheduledTime.test.ts`        | 291  | 156      | 0.54× |
| `PostAggregate.ts` / `aggregates.post.test.ts`      | 619  | 731      | 1.18× |
| `CompletePostPublishingUseCase.ts` / its unit suite | 368  | 691      | 1.88× |
| `PrismaPostRepository.ts` / its unit suite          | 903  | 824      | 0.91× |

Value objects ≈ 1.0×, behaviour-dense entities and use cases 1.4–1.9×, adapters ≈ 0.9×, wiring ≈ 0,
templates/ports ≈ 0.3×. **CODE** = non-test, non-doc source, and **includes migration SQL** (it
mutates the database and is reviewed as source). **EVIDENCE** = tests + docs + runbooks + openspec.

### 9.1 · PR 1b — record foundations

| Line item                                                                             | Reference file (measured)                                                                                                                 | CODE +   | CODE − |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| `schema.prisma`: model (24 cols, 8 CHECKs, 4 idx, 3 rel) + 4 enums + 3 back-relations | `PostMedia` 22 lines for 11 cols/4 idx (`schema.prisma:799-820`); `Post` 697-776                                                          | 78       | 0      |
| `migration.sql` + `down.sql`                                                          | `20260910000000_rls_initplan_post_trio/migration.sql` **91**, `down.sql` **69** (RLS only, 3 tables)                                      | 140      | 0      |
| `tenantGuard.ts` enrollment                                                           | one Set entry (`:91-153`)                                                                                                                 | 1        | 0      |
| 5 value objects                                                                       | `ApprovalStatus.ts` **180**, `CampaignStatus.ts` **165**, `UTMParameters.ts` **150**, `ShortCode.ts` **110**, `CredentialGroup.ts` **32** | 580      | 0      |
| `ChannelPublication.ts`                                                               | `TrackedLink.ts` **326**, `MediaAsset.ts` **323**, `ApprovalWorkflow.ts` **231**                                                          | 330      | 0      |
| `ChannelPublications.ts`                                                              | `ConversationNote.ts` **122**                                                                                                             | 150      | 0      |
| `ContentLockedError.ts`                                                               | small error class                                                                                                                         | 40       | 0      |
| `PostAggregate.ts` 7 root methods + invariant + `isEditable`                          | file **619** today                                                                                                                        | 130      | 35     |
| `PublishStatus.ts` new value + edges                                                  | **206** today                                                                                                                             | 24       | 4      |
| `PostEvents.ts` 2 internal events + 2 v1 builders                                     | **353** today, ~8 events ⇒ ~40/event                                                                                                      | 160      | 22     |
| `PostRepository.ts` `savePublication`                                                 | `MediaAssetRepository.ts` **69**                                                                                                          | 14       | 0      |
| `PostAggregateMapper.ts` (relocated)                                                  | **283** today                                                                                                                             | 95       | 0      |
| `PrismaPostRepository.ts` + new `PostPublicationWrites.ts`                            | **903** today                                                                                                                             | 170      | 6      |
| barrels                                                                               | `value-objects/index.ts` **86**                                                                                                           | 12       | 0      |
| **CODE subtotal**                                                                     |                                                                                                                                           | **1924** | **67** |

| Evidence line item                                                                                             | Reference (measured)                                             | +        |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| `channelPublication.test.ts` (entity: budget, all-or-nothing, retraction, 4 `alertTransition` clauses, expiry) | 480 CODE × 1.5                                                   | 720      |
| `channelPublications.derive.test.ts`                                                                           | `ScheduledTime.test.ts` **156**, `UTMParameters.test.ts` **143** | 230      |
| 5 VO suites                                                                                                    | 580 CODE × 1.0 (measured VO band)                                | 580      |
| `postAggregate.publications.test.ts` (S2 five fixtures, lock, C2 edges, W7, Q10)                               | `aggregates.post.test.ts` **731**                                | 430      |
| `PostEvents` v1 payload assertions                                                                             | 160 × 0.5                                                        | 80       |
| `PrismaPostRepository.test.ts` extension (savePublication, tripwire, CAS)                                      | **824** today                                                    | 180      |
| `MULTI_TENANT_GUARDS.md` rows                                                                                  | **1838** today (`:151`, `:1184-1192`)                            | 14       |
| **EVIDENCE subtotal**                                                                                          |                                                                  | **2234** |

**PR 1b: CODE 1991 changed · EVIDENCE 2234 changed · total 4225.**

### 9.2 · PR 1b2 — alert consumer

| Line item                                                     | Reference (measured)                                                                                                           | CODE +   | CODE − |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ |
| `schema.prisma` enum value + `RetractionAlertMedium` + ledger | `PostMedia` **22**                                                                                                             | 32       | 0      |
| migration #2 + down                                           | trio migration **91** / **69**                                                                                                 | 60       | 0      |
| `NotificationType.ts` value + `isUrgent()`                    | **143** today                                                                                                                  | 20       | 0      |
| `isTypeEnabled.ts` + the two call-site refactors              | `CreateNotificationUseCase.ts` **126**, `SendEmailNotificationService.ts` **48**                                               | 45       | 14     |
| `EMAIL_ENABLED_TYPES` + wiring                                | `SendEmailNotificationService.ts` **48**                                                                                       | 8        | 0      |
| `RaiseRetractionAlertUseCase.ts`                              | `CompletePostPublishingUseCase.ts` **368**, `CreateNotificationUseCase.ts` **126**                                             | 260      | 0      |
| `ResolveRetractionAlertUseCase.ts`                            | same                                                                                                                           | 130      | 0      |
| ledger port + `RetractionAlertDeliveryPort.ts`                | `MediaAssetRepository.ts` **69**, `NotificationDispatchPort.ts` **40**                                                         | 135      | 0      |
| `ExternalNotifierPort.broadcast` + dispatcher promotion       | `ExternalNotificationDispatcher.ts` **88**                                                                                     | 40       | 10     |
| 3 media adapters                                              | `NotificationDispatchAdapter.ts` **40**                                                                                        | 190      | 0      |
| `PrismaRetractionAlertDeliveryLedger.ts`                      | `PublishLogRepository.ts` **117**                                                                                              | 120      | 0      |
| `RetractionAlertEventHandler.ts`                              | `TriageDispatchEventHandler.ts` **77** × 1.4 (two event types)                                                                 | 110      | 0      |
| email template + adapter case                                 | `TransactionalEmailAdapter.ts` **138**                                                                                         | 75       | 0      |
| container wiring + registry                                   | `setupNotificationUseCases.ts` **83**, `setupExternalNotificationUseCases.ts` **113**, `types.ts` **660**, `index.ts` **1341** | 90       | 0      |
| **CODE subtotal**                                             |                                                                                                                                | **1315** | **24** |

| Evidence line item                                   | Reference (measured)                                                       | +        |
| ---------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| `raiseRetractionAlert.test.ts`                       | 260 × 1.88                                                                 | 490      |
| `resolveRetractionAlert.test.ts`                     | 130 × 1.4                                                                  | 180      |
| `isTypeEnabled.test.ts` + the two suites' regression | `CreateNotificationUseCase.test.ts` **116**, `EmailAddress.test.ts` **79** | 150      |
| `RetractionAlertEventHandler.test.ts`                | `PostCommandHandlers.publish.test.ts` **204**                              | 200      |
| adapters + ledger adapter suites                     | 310 × 0.8                                                                  | 250      |
| template/port assertions                             | 210 × 0.3                                                                  | 65       |
| `docs/api/notifications.md`                          | **544** today                                                              | 60       |
| **EVIDENCE subtotal**                                |                                                                            | **1395** |

**PR 1b2: CODE 1339 · EVIDENCE 1395 · total 2734.**

### 9.3 · PR 1b3 — thread contract

| Line item                                                                   | Reference (measured)                                                                   | CODE + | CODE − |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------ | ------ |
| `types.ts` `ThreadPublishFailure` + `ProviderAdapter.ts` signature          | `ProviderAdapter.ts` **226** (`:152-155`)                                              | 16     | 2      |
| `XAdapter.ts` — 4 `err` sites + declaration move                            | file **684**; method **`:301-379`** read in this pass                                  | 14     | 6      |
| `InstagramAdapter.ts` — 3 `err` sites                                       | file **749**; method **`:447-509`** read                                               | 8      | 4      |
| Pinterest / Telegram / LinkedIn / Snapchat stubs — 1 `err` + signature each | **415 / 541 / 518 / 353**; methods `:217-225`, `:225-232`, `:216-224`, `:222-230` read | 16     | 8      |
| `_template/src/index.ts`                                                    | `:226`, `:294`                                                                         | 8      | 4      |
| `publishHandler.ts` failure path carries the fragments                      | **867** today (`:583-622`)                                                             | 30     | 6      |
| **CODE subtotal**                                                           |                                                                                        | **92** | **30** |

| Evidence line item                                 | Reference (measured)                                    | +       | −      |
| -------------------------------------------------- | ------------------------------------------------------- | ------- | ------ |
| `XAdapter.publish.test.ts` rewrite + 2 new cases   | the `publishThread` block is `:128-256` = **128** lines | 110     | 30     |
| `TelegramAdapter.test.ts:366-384` rewrite          |                                                         | 30      | 12     |
| Pinterest / LinkedIn / Snapchat / Instagram suites | 4 × ~20                                                 | 80      | 24     |
| workers thread-failure suite                       |                                                         | 90      | 0      |
| **EVIDENCE subtotal**                              |                                                         | **310** | **66** |

**PR 1b3: CODE 122 · EVIDENCE 376 · total 498.** The only PR in the chain under 400 CODE _and_
under 600 total.

### 9.4 · PR 1c — the coupled unit

| Line item                                                      | Reference (measured)                                                         | CODE +   | CODE −  |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------- | ------- |
| 4 new use cases (Open, Record, Confirm, Expire)                | `CompletePostPublishingUseCase.ts` **368**, `SchedulePostUseCase.ts` **223** | 700      | 0       |
| `CompletePostPublishingUseCase.ts` → reconciliation            | **368** today (`:146-153`, `:326-347`, `:351-368` deleted)                   | 90       | 80      |
| `SchedulePostUseCase.ts` targets + Result seam                 | **223** today                                                                | 45       | 18      |
| `packages/core/posts/src/index.ts`                             |                                                                              | 8        | 0       |
| `saga.ts` reader + wait + forwarder + pivot + scheduling step  | **1227** today                                                               | 230      | 180     |
| `cqrs.ts` command + `reasonCode`                               | **690** today                                                                | 40       | 6       |
| `SagaIntegration.ts` + new `publishAdmission.ts`               | **895** today                                                                | 140      | 45      |
| new `postChannelRoutes.ts` (confirm) + registration            | `postRoutes.ts` **702**                                                      | 110      | 0       |
| `PostCommandHandlers.ts` + container                           | **722** / **251** / **660**                                                  | 90       | 0       |
| `SemanticLockPort.holder` + `RedisSemanticLockStore`           | `SemanticLockPort.ts` **38**                                                 | 25       | 0       |
| `workerTenantContext.ts` (new)                                 | `apps/api/src/security/tenantContext.ts` **189**                             | 90       | 0       |
| `workerContainer.ts`                                           | **18** today                                                                 | 75       | 0       |
| `classifyPublishFailure.ts` (new)                              | closed `PublishError` union                                                  | 110      | 0       |
| `publishOutcomeRecorder.ts` (new: CAS ×8 + durable job + DLQ)  |                                                                              | 180      | 0       |
| `publishHandler.ts` skip path + W4/D10 deletions               | **867** today                                                                | 120      | 150     |
| `publishHandlerTypes.ts` + `publishWorker.ts` + `package.json` | **157**                                                                      | 20       | 6       |
| `env.ts` `RETRACTION_ACTION_WINDOW_HOURS`                      | `:309` shape                                                                 | 8        | 0       |
| `RetractionActionWindowSweep.ts` (new)                         | `DeletionRecordDegrader.ts` **176**                                          | 180      | 0       |
| `PendingRetractionSweepReads.ts` + port                        | `PublishLogRepository.ts` **117**, `AccountNotificationReader.ts` **19**     | 95       | 0       |
| `index.ts` sweep registration                                  | **1341** today (`:950-962` shape)                                            | 18       | 0       |
| `SchedulingPostHandlers.ts` C3 guards                          | **403** today                                                                | 70       | 20      |
| `prometheus/alerts/publish-record.yml`                         | `saga.yml` **180** total; the rule shape `:158-168` = **11**                 | 14       | 0       |
| **CODE subtotal**                                              |                                                                              | **2458** | **505** |

| Evidence line item                                                        | Reference (measured)                                          | +        | −       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------- | -------- | ------- |
| 4 use-case suites                                                         | 700 × 1.88                                                    | 1320     | 0       |
| `CompletePostPublishingUseCase.test.ts` rewrite                           | **691** today                                                 | 160      | 140     |
| `sagaDeterministicIds.test.ts` rewrite + step table                       | **323** today                                                 | 300      | 110     |
| `InMemorySemanticLockStore.ts` + `RecordingLockStore.holder`              | `publishNowPromotionDoubles.ts` **94**                        | 110      | 0       |
| `RetractionActionWindowSweep.test.ts`                                     | 180 × 1.3                                                     | 235      | 0       |
| sweep reader/port suite                                                   | 95 × 0.4                                                      | 40       | 0       |
| worker suites (classifier, recorder, skip, W4, mirror)                    | 595 × 0.9                                                     | 535      | 0       |
| `SchedulingPostHandlers.*.test.ts` C3                                     | 70 × 2                                                        | 140      | 0       |
| `postChannelRoutes.confirm.test.ts`                                       | 110 × 1.1                                                     | 120      | 0       |
| `alert-publish-outcome-unrecorded.md`                                     | `alert-saga-timeout.md` **122**, `alert-outbox-lag.md` **62** | 100      | 0       |
| `promtool` rule fixture                                                   |                                                               | 40       | 0       |
| `.env.example`, `.env.test.example`, `ENVIRONMENT_VARIABLES.md` (**409**) |                                                               | 30       | 0       |
| **EVIDENCE subtotal**                                                     |                                                               | **3130** | **250** |

**PR 1c: CODE 2963 · EVIDENCE 3380 · total 6343.** The largest unit in the chain by a factor of 1.5.

### 9.5 · PR 1d — read model + DoD suites + ADR

| Line item                                                                                   | Reference (measured)                                                                                                                                                                                   | CODE +  | CODE −  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------- |
| `PostReadModel` + `ChannelPublicationView`                                                  | `PostRepository.ts:184-198`                                                                                                                                                                            | 45      | 0       |
| `PrismaPostQueryRepository.ts` include + the two read shapes                                | **508** today (`:339-363`)                                                                                                                                                                             | 60      | 20      |
| `SchedulingPostHandlers.ts` include repoint                                                 | **403** today                                                                                                                                                                                          | 50      | 30      |
| `providerService.ts` + `projectRoutes.ts`                                                   |                                                                                                                                                                                                        | 50      | 35      |
| `RepoPort.listRecentChannelPublications` + `ChannelPublicationReads.ts` + `tenantHealth.ts` | `RepoPort.ts` **269**, `PublishLogRepository.ts` **117**                                                                                                                                               | 110     | 20      |
| 7 status unions                                                                             | `types.ts` **212**, `postsClient.ts` **227**, `postsService.ts` **286**, `PostQueryGetList.ts` **240**, `PostQuerySearchAnalytics.ts` **226**, `schedulingSchemas.ts` **101**, `postRoutes.ts` **702** | 12      | 0       |
| 6 UI maps + the dashboard tile                                                              | `PostCard.tsx` **242**, `PostsFilters.tsx` **218**, `posts/[id]/page.tsx` **597**, `dashboard/page.tsx` **182**, `useSchedulingDashboard.ts` **320**                                                   | 26      | 8       |
| `apps/client/types/scheduling.ts`                                                           | **47** today                                                                                                                                                                                           | 10      | 0       |
| **CODE subtotal**                                                                           |                                                                                                                                                                                                        | **363** | **113** |

| Evidence line item                                            | Reference (measured)                                          | +        |
| ------------------------------------------------------------- | ------------------------------------------------------------- | -------- |
| `sagaPartialPublishRecord.test.ts` — 13 cases                 | `sagaPublishNowPromotion.test.ts` **437** (≈6 cases) ⇒ ×2.2   | 950      |
| harness extension (record seeding, thread doubles)            | `publishNowPromotionHarness.ts` **620**                       | 180      |
| `postChannelPublicationTenantIsolation.test.ts`               | `publishWorkerTenantIsolation.test.ts` **304**                | 330      |
| `retractionAlert.test.ts`                                     | same band; `post-trio-tenant-isolation.test.ts` **801** upper | 340      |
| `retractionActionWindow.test.ts`                              | same band                                                     | 300      |
| `run-tests.sh` batches                                        | **510** today                                                 | 22       |
| `ADR-0024-post-channel-publication-record.md`                 | `ADR-0023-*.md` **240**                                       | 250      |
| `docs/api/saga.md` (**320**) + `saga-test-suites.md` (**91**) |                                                               | 70       |
| **EVIDENCE subtotal**                                         |                                                               | **2442** |

**PR 1d: CODE 476 · EVIDENCE 2442 · total 2918.**

### 9.6 · PRs 1e, 2a, 2b

| PR  | Line item                                                                                  | Reference (measured)                                                        | CODE    | EVIDENCE |
| --- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------- | -------- |
| 1e  | reconstruction script (`scripts/migrations/` does **not** exist yet — created here)        | `scripts/audit-raw-sql.ts` **394**, `scripts/generate-api-types.ts` **133** | 300     | —        |
| 1e  | `publicationRecordReconstruction.test.ts`                                                  | `publishWorkerTenantIsolation.test.ts` **304**                              | —       | 260      |
| 1e  | `publication-record-reconstruction.md` + batch                                             | `alert-saga-timeout.md` **122**                                             | —       | 118      |
|     | **1e subtotal**                                                                            |                                                                             | **300** | **378**  |
| 2a  | retry route in the existing `postChannelRoutes.ts` + use case + token                      | `postRoutes.ts` **702**, `SchedulePostUseCase.ts` **223**                   | 250     | —        |
| 2a  | route unit suite + `postChannelRetry.test.ts` + batch                                      | `publishWorkerTenantIsolation.test.ts` **304**                              | —       | 486      |
|     | **2a subtotal**                                                                            |                                                                             | **250** | **486**  |
| 2b  | panel component (new file) + editor fix + admin parity + preferences toggle + client types | `PostCard.tsx` **242**, `posts/[id]/page.tsx` **597**                       | 585     | —        |
| 2b  | component + admin suites                                                                   | frontend vitest tier                                                        | —       | 560      |
|     | **2b subtotal**                                                                            |                                                                             | **585** | **560**  |

### 9.7 · Totals and the standard fields

| PR               | CODE changed | EVIDENCE changed |     Total | >400 CODE | Sound on `main` alone | Split seam if Edward wants children                                                                                                        |
| ---------------- | -----------: | ---------------: | --------: | --------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1b               |         1991 |             2234 |  **4225** | 5.0×      | Yes                   | **1b-i** schema+migration+#39 (219/194) · **1b-ii** domain (1449/2040) · **1b-iii** port+adapter+doubles (323/180)                         |
| 1b2              |         1339 |             1395 |  **2734** | 3.3×      | Yes                   | **1b2-i** type+migration+`isTypeEnabled` (179/210) · **1b2-ii** ports+adapters+use cases+handler+ledger (1160/1185)                        |
| 1b3              |          122 |              376 |   **498** | no        | Yes                   | —                                                                                                                                          |
| 1c               |         2963 |             3380 |  **6343** | 7.4×      | **Assembled only**    | **1c-1** application+CQRS (941/1480) · **1c-2** saga+lock (630/450) · **1c-3** worker+sweep+confirm+rule+C3 (1392/1450) — D15.5 binds 1c-3 |
| 1d               |          476 |             2442 |  **2918** | 1.2×      | Yes                   | **1d-i** read model + repoints (476/70) · **1d-ii** DoD suites + ADR (0/2372)                                                              |
| 1e               |          300 |              378 |   **678** | no        | Yes                   | —                                                                                                                                          |
| 2a               |          250 |              486 |   **736** | no        | Yes                   | —                                                                                                                                          |
| 2b               |          585 |              560 |  **1145** | 1.5×      | Yes                   | **2b-i** panel+confirm button · **2b-ii** editor+parity+toggle                                                                             |
| **Change total** |     **8026** |        **11251** | **19277** |           |                       |                                                                                                                                            |

**Measured EVIDENCE:CODE for the change = 1.40×**, well below the ~2.5–3× empirical multiplier from
the two-tier budget. That is not a sign of thin tests: it is what a change dominated by NEW domain,
port and adapter surface looks like, versus changes dominated by edits to existing behaviour (where
one changed line buys several assertions). The two heaviest EVIDENCE items — 1d's five integration
suites (2442) and 1c's use-case suites (1320) — sit at or above their measured pair ratios.

- **Chained PRs recommended: YES** (already the design's shape — eight PRs).
- **400-line CODE budget: EXCEEDED in 1b, 1b2, 1c, 1d (marginally) and 2b.** Per this change's
  criterion the 400 CODE figure is reported as a **review signal**, not a gate; the governing rule is
  Edward's per-file criterion (400–600 lines per file, ≤~800 only when strictly necessary), and §9.8
  is the file-by-file answer to it.
- **Decision needed before apply: YES** — three ratifications, §9.9.
- **Recommended chain strategy: `feature-branch-chain`.** Not a preference: 1c's three children are
  individually unsound on `main` (§0.3), which is exactly the condition the strategy exists for. A
  draft tracker branch accumulates 1b → 1b2/1b3 → 1c's three children → 1d → 1e → 2a → 2b; PR #1
  targets the tracker, each later child targets the immediate previous branch; only the tracker
  merges to `main`. Under `stacked-to-main` the same chain works for every PR **except** 1c, which
  would have to land as one 6.3k-line PR.

### 9.8 · Per-file size watch (the criterion that governs)

| File                                                                   |  Now |                                                  After | Verdict                                                                                               |
| ---------------------------------------------------------------------- | ---: | -----------------------------------------------------: | ----------------------------------------------------------------------------------------------------- |
| `packages/core/domain/src/entities/ChannelPublication.ts`              |    — |                                                   ~330 | new, in band                                                                                          |
| `packages/core/domain/src/aggregates/ChannelPublications.ts`           |    — |                                                   ~150 | new, in band                                                                                          |
| 5 new value objects                                                    |    — |                                            32–180 each | in band                                                                                               |
| `packages/core/domain/src/aggregates/PostAggregate.ts`                 |  619 |                                                   ~714 | exception band; seam named (T1b.9)                                                                    |
| `packages/core/domain/src/events/PostEvents.ts`                        |  353 |                                                   ~491 | in band                                                                                               |
| `packages/adapters/db-prisma/src/post/PrismaPostRepository.ts`         |  903 |             ~933 + new `PostPublicationWrites.ts` ~140 | **already over on arrival**; growth capped at ≤30 by the seam; pre-existing oversize → backlog (T7.2) |
| `apps/workers/src/publishHandler.ts`                                   |  867 |                                     ~837 + 2 new files | **over, pre-existing**; this change reduces it; backlog row                                           |
| `packages/shared/src/saga.ts`                                          | 1227 |                                                  ~1277 | **over, pre-existing**; split deliberately NOT done in 1c (would double the diff) → backlog row       |
| `apps/api/src/saga/SagaIntegration.ts`                                 |  895 |                  ~840 + new `publishAdmission.ts` ~150 | split applied in 1c; still over pre-existing                                                          |
| `apps/api/src/posts/postRoutes.ts`                                     |  702 | 708 + new `postChannelRoutes.ts` (110 → ~200 after 2a) | seam applied; both new-route PRs stay in band                                                         |
| `packages/shared/src/cqrs.ts`                                          |  690 |                                                   ~724 | exception band                                                                                        |
| `apps/api/src/cqrs/handlers/PostCommandHandlers.ts`                    |  722 |                                                   ~790 | exception band                                                                                        |
| `apps/api/src/index.ts`                                                | 1341 |                                                  ~1359 | **over, pre-existing**; +18 registration only; backlog row                                            |
| `apps/api/src/admin/SchedulingPostHandlers.ts`                         |  403 |                                                   ~453 | in band                                                                                               |
| `apps/client/app/[locale]/dashboard/posts/[id]/page.tsx`               |  597 |                                                   ~617 | exception band; the panel goes in its own file (T2b.2)                                                |
| `packages/core/notifications/src/RaiseRetractionAlertUseCase.ts`       |    — |                                                   ~260 | new, in band                                                                                          |
| `apps/api/src/infrastructure/retention/RetractionActionWindowSweep.ts` |    — |                                                   ~180 | new, in band                                                                                          |

### 9.9 · Ratifications needed from Edward before `sdd-apply`

1. **Chain strategy** — `feature-branch-chain` (recommended, §9.7) or `stacked-to-main` with 1c as a
   single 6.3k-line PR.
2. **Whether to split 1b / 1b2 / 1d / 2b into the children named in §9.7.** The boundaries are given
   with their measured CODE/EVIDENCE splits; each child is sound on `main`.
3. **Where the five DoD integration suites live.** Design.md:419 assigns them to **1d**, and this
   file follows the design. The consequence, named rather than smoothed over: those five suites will
   be **GREEN on authoring** for the 1c behaviours they cover, so RED-first is satisfied at the
   behaviour level by 1c's unit-tier REDs but **not** at the suite level for them. The alternative is
   to author them inside the 1c tracker, which restores suite-level RED-first at a measured cost of
   **1c EVIDENCE +1900 / 1d EVIDENCE −1900**.

---

## 10 · Verification and gates

### 10.1 · Strict TDD (mode ACTIVE)

Every behavioural task above is written RED → GREEN in that order. The RED must be **recorded** (the
failing output pasted in the PR body), and every planted red path — fitness #39 (T1b.4), the
`promtool` rule (T1c.18) — must be **restored sha256-exact** and re-confirmed at zero before the PR
opens. Three reds are "dangerous" by the specs' own verification notes and must assert PERSISTED
state rather than a returned value or an HTTP status:

- the partial-publish scenario fails today by reaching saga `FAILED` with the row left `DRAFT`;
- the lock scenario fails today by **ACCEPTING** an edit to content live on a provider;
- the double-submit retry fails today by **PUBLISHING TWICE** to a provider double — so it asserts
  the number of provider calls and the recorded attempt count;
- the interrupted-thread scenario fails today by **LOSING** the fragment ids — so it asserts the
  persisted references, not the returned error;
- the alert dedupe scenario asserts the **NUMBER** of alerts.

### 10.2 · Per-PR gate list (all must read 0/0 — no deferral, no "pre-existing")

`pnpm lint --max-warnings 0` · `tsc` · `pnpm format:check` · the fitness suite with, per PR:

| PR  | Fitness checks that must be exercised (beyond the always-on set)                                                                                                                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1b  | **#39 at 0 with its RED PATH proven**; #38 (floor 6 unchanged, no `deletedAt` added); #2/#3/#4 (core purity); #40 Part A+B; #9/#10/#8                                                                                                                                                                                                                                                                           |
| 1b2 | #39 stays 0 **without** enrolling the ledger (no `accountId` ⇒ not a bearing model — state it in the PR body); #13/#14/#16; #9/#10                                                                                                                                                                                                                                                                              |
| 1b3 | #32; #9/#10 on seven provider files                                                                                                                                                                                                                                                                                                                                                                             |
| 1c  | #1/#6/#21/#22 (no Prisma outside composition roots; handlers delegate); #7 (deterministic ids); #11 (the sweep is scheduler-registered — no raw `setInterval`); #16 (the window read only through `env`, only in `apps/api`); #23; #40 Part A+B (the worker opens no `$transaction` of its own; `apps/workers/src` is outside both parts — residual (5), restated); **#41** (the C3 compare-and-swap shape); #4 |
| 1d  | **#30** (each new suite named by exactly one `run_batch`; ratchet baseline 21 must not rise); #38's `db-prisma` ratchet not risen; #12/#26; the `pg_catalog` RLS coverage gate green for the new table                                                                                                                                                                                                          |
| 1e  | #8 (the `// canon-exception: migration:<ts>` marker is the sanctioned scenario); #30                                                                                                                                                                                                                                                                                                                            |
| 2a  | **#7 at 0**; #30                                                                                                                                                                                                                                                                                                                                                                                                |
| 2b  | #12 (`@component`); #26; #9/#10                                                                                                                                                                                                                                                                                                                                                                                 |

Integration tiers need `pnpm db:up` first (Postgres + Redis) — never skip a suite because a service
is down, and never skip the migration because the DB is not running.

### 10.3 · Test batches (#30, exactly once each)

| Suite                                           | Batch                                            | Where                                                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sagaPartialPublishRecord.test.ts`              | `integration:saga-recovery` (append)             | `run-tests.sh:336-339`, `CONCURRENCY=1 TIMEOUT=120000`                                                                                                                  |
| `postChannelPublicationTenantIsolation.test.ts` | `integration:tenant-isolation` (append)          | `run-tests.sh:274-296`                                                                                                                                                  |
| `retractionAlert.test.ts`                       | **new** `integration:retraction-alert`           | `CONCURRENCY=1` — it counts deliveries, so a sibling sharing the runner would make the counts ambiguous (the `integration:mfa-backup-single-use` rationale, `:307-314`) |
| `retractionActionWindow.test.ts`                | **new** `integration:retraction-window`          | `CONCURRENCY=1` — clock-driven expiry                                                                                                                                   |
| `publicationRecordReconstruction.test.ts`       | **new** `integration:publication-reconstruction` | `CONCURRENCY=1`                                                                                                                                                         |
| `postChannelRetry.test.ts` (2a)                 | **new** `integration:channel-retry`              | `CONCURRENCY=1` — it races the same credential-equivalent on purpose                                                                                                    |

### 10.4 · Deploy order (1e)

`migrate → deploy → run 1e`, inside an announced maintenance window. A job firing inside the window
fails closed and 1e re-issues it (late, never lost). Acceptance:
`worker_publish_job_unrecoverable_total{reason="pre_change_job"}` reads zero afterwards. Rollback for
Slice 1 is NOT code-only: revert the range **and** apply both `down.sql` files **and** remove the
`TENANT_SCOPED_MODELS` entry + the guards-doc row in the same revert.

---

## 11 · Dependencies, successors and what consumes what

| Edge                                        | Direction                                  | What it means for this chain                                                                                                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `post-persistence-adapter-relocation`       | **prerequisite — NOT YET PROPOSED (§0.2)** | must archive before PR 1b. N-COR-8 changes only the publication facet of the relocated files; never the move, the tenant wiring, the seven fitness edits, or the ADR-0023 / guards-doc path lines                                                                                |
| N-COR-1 `post-publish-status-integrity`     | done                                       | archived (`c23ec2c8`); its capability is promoted, so this change's delta can archive                                                                                                                                                                                            |
| **N-COR-9** "webhook-driven post status"    | successor                                  | consumes D5's window: after N-COR-8 the five processors' `prisma.post.update({status:"PUBLISHED"})` has nothing legitimate to write, so N-COR-9 is a DELETION. It also retires `PublishLog`'s last two correlation readers                                                       |
| **N-COR-10** "thread atomicity: retraction" | successor                                  | consumes D16's seam: writes `retractionBlockedCause = NULL` at record time (no window, no alert while attempting), calls `markRetractionOutcome`, and its `EXHAUSTED` opens the window. Owns the retraction port, the per-provider adapters and the capability table             |
| **`customer-notification-policy`**          | successor                                  | inherits the per-medium model (withdrawn here by Q20 scoping) **and Q21's shared-switch rule** for Slack/Teams; applies to all ten notification types                                                                                                                            |
| **the SMS change**                          | successor                                  | registers ONE `RetractionAlertDelivery { medium: "sms" }` per-member adapter under the same per-type switch; nothing else in this change moves                                                                                                                                   |
| **`integration-events-v2`**                 | successor                                  | owns the outbound catalog growth (`post.partially_published`, `post.channel.*`, `post.retraction_pending`), the `providerResults` rename, per-subscription retry/DLQ, and documenting the catalog (absent from `docs/api/webhooks.md`). **N-COR-8 adds no external event** (Q19) |
| **push**                                    | gap                                        | no owning change; waits on a mobile API. Named, never silently dropped                                                                                                                                                                                                           |

**Announce with the release**: `post.failed` fires for the FIRST time under this change
(design.md:438) — subscribers who never received it will start to. The shape is the registry's v1;
no subscriber has ever been tested against it.

---

## 12 · Risks this breakdown introduces or inherits

| Risk                                                                                                                                                        | Where                | Mitigation in this plan                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The prerequisite does not exist** — 1b cannot start                                                                                                       | §0.2                 | T0.1; no workaround is admissible (design.md:60)                                                                                                                                                                          |
| 1c is 6.3k changed lines and its children are unsound alone                                                                                                 | §0.3, §9.4           | `feature-branch-chain` with a tracker; D15.5 binds the confirm act + sweep + worker write into one child                                                                                                                  |
| The five DoD integration suites land GREEN (not RED) for 1c's behaviour                                                                                     | §9.9 item 3          | named openly with the measured cost of the alternative; behaviour-level RED is carried by 1c's unit suites                                                                                                                |
| Four files are over the size band BEFORE this change touches them (`saga.ts` 1227, `index.ts` 1341, `PrismaPostRepository.ts` 903, `publishHandler.ts` 867) | §9.8                 | growth capped by three applied seams; the pre-existing oversize is a backlog row, not silently absorbed                                                                                                                   |
| OCC contention under an 11-channel fan-out                                                                                                                  | T1c.14               | the 8-try jittered retry bounded at **1.975 s**, inside the 60 s `lockDuration`; then the durable outcome job; then the DLQ with an alert and a runbook                                                                   |
| The N-COR-9 window: five live writers can clobber the word between root writes                                                                              | T1d.4, design.md:148 | repaired by construction at the next root write; invisible to every DECIDING reader (`/start`, retry, `isEditable`, the C3 guards read the record; top-performers requires `publishedAt NOT NULL`; the tile is repointed) |
| Sweep starvation above 100 simultaneous poison rows                                                                                                         | T1c.16               | visible as a FLAT non-zero `retraction_action_window_sweep_failures_total`; the remedy is the rows' cause, named in the ERROR log                                                                                         |
| A deploy without 1e strands every scheduled post                                                                                                            | §6                   | the migrate → deploy → 1e order, the rate bound, and the zero-reading acceptance metric                                                                                                                                   |
| Provider classifier unevenness across 11 providers (§2F's classifier starvation)                                                                            | T1c.14               | `unclassifiable` is a first-class class: bounded by the same budget, then excluded with a reason NAMING the uncertainty — never a guess, never forever                                                                    |
| The alert's per-medium delivery is best-effort                                                                                                              | T1b2.5               | a crash between a target's ledger claim and its send loses THAT send; counted in `retraction_alert_delivery_total{medium,result}` and logged per raise                                                                    |
