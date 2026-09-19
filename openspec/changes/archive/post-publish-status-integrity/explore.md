# Exploration: post-publish-status-integrity (N-COR-1)

> **Persistence note**: investigation executed by the sdd-explore agent (read-only toolset, no Write); artifact materialized verbatim by the orchestrator. Load-bearing claims spot-checked against the tree before persisting: the `status` drop at `PostCommandHandlers.ts:220-234`, the dead promotion methods (`markAsPublished`/`startPublishing`/`markAsFailed` — zero production callers), and the FSM forbidding `DRAFT→PUBLISHED` direct (`PublishStatus.ts`).

## 0. Scope & method

Read-only investigation at `main 31e2a2ad` (the CORE-PUBLISHING lane is disjoint from the in-flight auth work). Every claim below is traced to `file:line`. The reported mechanism was re-derived from the tree, not trusted.

## 1. Verified current-state map (with file:line)

### 1.1 The publish-now flow, entry to intended promotion

1. **HTTP entry** — `apps/api/src/saga/SagaIntegration.ts:356` `POST /sagas/post-publishing/start` (`mode:"publish-now"`). Ownership/tenant checks; existing-draft path asserts `post.status.value === "DRAFT"` (`SagaIntegration.ts:428-432`) before starting. Starts `post-publishing-saga` (`SagaIntegration.ts:477`).
2. **Saga definition** — `packages/shared/src/saga.ts:963-1019` `createPostPublishingSagaDefinition()`:
   - preCommit (compensable): `ValidatePostDataStep` (`saga.ts:432`), `CreatePostStep` (`saga.ts:489`)
   - pivot: `SchedulePublishingJobsStep` (`saga.ts:651`, `pivotStepIndex=2`)
   - postCommit (retryable): `WaitForPublishingCompletionStep` (`saga.ts:751`), **`UpdatePostStatusStep` (`saga.ts:865`)**
3. **Create** — `CreatePostStep.execute` issues `post.create` (`saga.ts:534-546`); records `version` from the create result (`saga.ts:570`, `0` for new posts). Existing-draft reuse sets `skippedCreation:true` and records **no** `version` (`saga.ts:520-525`).
4. **Pivot / enqueue** — `SchedulePublishingJobsStep` enqueues one BullMQ job per channel via the injected `queueJob` (`saga.ts:706-718`; `SagaIntegration.ts:290-315`). A `RereadCheck` re-confirms `Post.status === "DRAFT"` before enqueue (`SagaIntegration.ts:334-340`, `saga.ts:978-1000`).
5. **Worker publishes** — `apps/workers/src/publishHandler.ts:721` `handleJob` renders + publishes to the provider, writes `publish_log` `OK` (`publishHandler.ts:379-388`), and notifies the saga `publish.job.completed` (`publishHandler.ts:407-412`). **It never touches `Post.status`** (searched the whole file — only `publish_log` and thread/tweet `status`).
6. **Wait** — `WaitForPublishingCompletionStep` (`saga.ts:751-851`) consumes the completion signal; on all-completed sets `publishingComplete: status.failed === 0` (`saga.ts:826`) and returns `succeeded`.
7. **Intended promotion** — `UpdatePostStatusStep.execute` (`saga.ts:872-945`).

### 1.2 The intended promotion step (the defect site)

`UpdatePostStatusStep.execute` (`saga.ts:891-921`):

```
newStatus = publishingSuccess ? "PUBLISHED" : "FAILED"
updateCommand = { type: "post.update", data: { status: newStatus, publishedAt?, expectedVersion? }, ... }
result = await executeCommand(updateCommand)   // routes to CQRS bus → UpdatePostCommandHandler
```

It routes a **status transition** through `POST_COMMANDS.UPDATE_POST` (`type:"post.update"`), i.e. the content-update command.

### 1.3 The command handler that drops the fields

`UpdatePostCommandHandler.handle` — `apps/api/src/cqrs/handlers/PostCommandHandlers.ts:198-308`:

- `PostCommandHandlers.ts:220-225`: `if (data.status) { log.warn(... "UpdatePostCommand contains status which is not supported by the use case — ignored"); }` — **`status` is discarded**. `publishedAt` is never referenced at all.
- `PostCommandHandlers.ts:227-234`: delegates to `updatePostUseCase.execute({ postId, body?, title?, tags?, expectedVersion? })` — **no `status`, no `publishedAt`**.
- `PostCommandHandlers.ts:296-300`: returns `{ success: true, data: { version: 2 } }` regardless — a **hardcoded** version (also `previousVersion:1/newVersion:2` at `:264-265`).

So `executeCommand` returns `{ success: true }`; `UpdatePostStatusStep` reads `result.success === true` (`saga.ts:923`) and returns `{ outcome: "succeeded", data: { status: newStatus, postId } }`. The saga records the step succeeded and reaches `COMPLETED` — **while the DB row is untouched**.

### 1.4 The use case (why the drop is "defensible" but the routing is wrong)

`UpdatePostUseCase.execute` — `packages/core/posts/src/UpdatePostUseCase.ts:65-164`:

- It is a **content-only** use case: it mutates via `post.updateContent(...)` (`:124`) and only when `body||title||summary||tags` is present (`:123`). It has **no `status` / `publishedAt` concept whatsoever**.
- With the saga's payload (status/publishedAt only, no content), the `if` at `:123` is false → nothing mutates → it saves the unchanged aggregate (`:143`), dispatches no events, and returns a DTO with `status: post.status.value` = still `"DRAFT"` (`:157`).
- Guard at `:100` `if (!post.isEditable)`: a `DRAFT` post IS editable, so it passes — the command "succeeds" with zero effect.

### 1.5 The domain HAS the right machinery — but it is unwired

`packages/core/domain/src/aggregates/PostAggregate.ts`:

- `startPublishing()` (`:375-394`) → PUBLISHING; `markAsPublished()` (`:399-421`) → PUBLISHED and **sets `_publishedAt = new Date()`** + emits `PostPublished`; `markAsFailed()` (`:426-451`) → FAILED.
- **These have ZERO production callers** — `rg "markAsPublished|startPublishing|markAsFailed"` over `**/src/**` returns only the definitions (orchestrator re-confirmed with `rg -g '*.ts' … | rg -v PostAggregate.ts|.test.|/tests/` → empty). The promotion path in the domain is correct but dead.

### 1.6 The state machine constrains any fix

`packages/core/domain/src/value-objects/PublishStatus.ts:28-52` `VALID_TRANSITIONS`:

- `DRAFT → [PENDING_REVIEW, SCHEDULED, PUBLISHING, CANCELLED]` — **`DRAFT` cannot go directly to `PUBLISHED`.**
- `PUBLISHING → [PUBLISHED, FAILED]`; `PUBLISHED → []` (terminal).
- The saga never calls `startPublishing`, so the post is `DRAFT` when the promotion step runs. Even a correct `markAsPublished()` call would fail with `InvalidStateTransitionError` from `DRAFT`.

### 1.7 Command schema layer

`packages/shared/src/cqrs.ts`: `POST_COMMANDS.UPDATE_POST="post.update"` (`:143`), `PUBLISH_POST="post.publish"` (`:145`). `UpdatePostCommandSchema` **advertises `status`** (`:206`, enum DRAFT/SCHEDULED/PUBLISHED/FAILED, optional) — a field the handler drops. `PublishPostCommandSchema` (`:225-246`).

## 2. The defect demonstrated from the code

**Claim "COMPLETED but DRAFT" — CONFIRMED.** Trace: worker publishes → `publish_log` OK + `publish.job.completed` (`publishHandler.ts:379-412`) → `WaitStep` succeeds with `publishingComplete:true` (`saga.ts:826`) → `UpdatePostStatusStep` emits `post.update{status:"PUBLISHED",publishedAt}` (`saga.ts:903-921`) → `UpdatePostCommandHandler` warns-and-drops `status`, ignores `publishedAt` (`PostCommandHandlers.ts:220-234`) → `UpdatePostUseCase` finds no content, saves unchanged, returns DTO `status:"DRAFT"` (`UpdatePostUseCase.ts:123,157`) → handler returns `{success:true,version:2}` → step returns `succeeded` → saga `COMPLETED`. **DB: `Post.status` still `DRAFT`, `publishedAt` still `null`, provider already received the post.**

**Claim "re-publish because still DRAFT" — CONFIRMED.** Both guards key off a status that never advances:

- `SagaIntegration.ts:428` (`post.status.value !== "DRAFT"`) — a truly-published post still reads `DRAFT`, so the existing-draft `/start` path accepts it again → **duplicate publish jobs / double-send**.
- `PublishPostCommandHandler.ts:362` (`post.status.value === "PUBLISHED"`) — never trips.

**Corroborating negative:** the `UpdatePostUseCase` FORBIDDEN guard for already-published (`:100-107`) and the aggregate's terminal `PUBLISHED` state (`PublishStatus.ts:45`) are the intended re-publish defenses — all inert because the status never reaches `PUBLISHED`.

## 3. Quality verdicts (per unit read)

| Unit                                                                         | Verdict                 | Evidence / reason                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UpdatePostStatusStep` (`saga.ts:865-946`)                                   | **MAL HECHO**           | Routes a status transition through `post.update` — a content-only command structurally unable to carry `status`. Its JSDoc promises OCC + idempotent promotion (`:854-863`) that the wiring defeats. The `FAILED` branch (`:891`) is also **unreachable** (see §6.4).                                                                         |
| `UpdatePostCommandHandler` (`PostCommandHandlers.ts:190-319`)                | **ARREGLABLE**          | Dropping `status` is defensible given the use case is content-only, BUT: (1) **phantom hardcoded versions** `previousVersion:1/newVersion:2/data.version:2` (`:264-265,298`) — fabricated, unrelated to the real aggregate version → MAL HECHO within an otherwise-defensible handler; (2) warns-and-drops a field its own schema advertises. |
| `UpdatePostCommandSchema` (`cqrs.ts:193-220`)                                | **ARREGLABLE**          | Advertises `status` (`:206`) and `mediaIds` that the handler silently drops (`PostCommandHandlers.ts:214-225`). A command schema must not promise a field no consumer honors.                                                                                                                                                                 |
| `PublishPostCommandHandler` (`PostCommandHandlers.ts:325-472`)               | **ARREGLABLE**          | Despite the name and the DoD's "ya valida", it does **not** persist any status change — it validates `!=PUBLISHED`, resolves channels, builds `jobIds` + events, returns. It is a start-publish/orchestration command, not a finalize-to-PUBLISHED one.                                                                                       |
| `PostAggregate` transitions (`PostAggregate.ts:375-451`)                     | **BIEN (but UNWIRED)**  | Correct guards, events, `publishedAt` set. Zero production callers — dead code.                                                                                                                                                                                                                                                               |
| `PublishStatus` machine (`PublishStatus.ts:28-52`)                           | **BIEN**                | Coherent FSM. Note it forbids `DRAFT→PUBLISHED`; this constrains the fix (§5).                                                                                                                                                                                                                                                                |
| `WaitForPublishingCompletionStep` (`saga.ts:751-851`)                        | **BIEN**                | The three-state `succeeded/failed/waiting` contract is well designed and documented; `publishingComplete` distinguishes success from partial-failure.                                                                                                                                                                                         |
| `publishHandler.ts` (worker)                                                 | **BIEN**                | Correct provider publish + receipts + saga notify; deliberately not the owner of `Post.status`. The consequence (sole promoter is the broken saga step) is an architecture gap, not a worker defect.                                                                                                                                          |
| Tests (`PostCommandHandlers.update.test.ts`, `sagaDeterministicIds.test.ts`) | **MAL HECHO (lock-in)** | `update.test.ts:42` asserts phantom `version===2`; `:173-183` documents success-with-empty-events (the saga's exact no-op shape); `sagaDeterministicIds.test.ts:100-102` asserts the step _emits_ `status:"PUBLISHED"` with a mock that returns `{success:true,data:{}}`, hiding the drop. They enshrine the bug.                             |

## 4. Existing test coverage touching this flow

- **No integration test asserts `Post.status === "PUBLISHED"` (or `publishedAt` set) after a publish-now saga.** Confirmed by searching `apps/api/tests` for `status … PUBLISHED` in saga tests.
- `apps/api/tests/integration/sagaCustomerFlow.test.ts:186-193` — a `PUBLISHED` post is a **fixture** used to test the "reject scheduling an already-PUBLISHED post" guard (`:494`), not an assertion that the saga promotes.
- `apps/api/tests/integration/sagaCrashRecovery.test.ts:1269-1274` — the test **manually** sets `status:"PUBLISHED"` via `prisma.post.update`, with a comment stating this is "NOT the publish worker" — implicit acknowledgement that the real flow does not do it.
- `apps/api/tests/unit/sagaDeterministicIds.test.ts:66-103` — unit-tests the step's emitted command (IDs, `expectedVersion`, `status`) against a mock; never touches persistence.
- `apps/api/tests/unit/sagaExistingPost.test.ts` — exercises `publish-now` start/admission; **no** assertion on final DB status.

**DoD gap:** the required integration test (`Post.status=PUBLISHED` + `publishedAt` after publish-now) must be authored; it does not exist today.

## 5. Approaches (tradeoffs) + recommendation

Canon that binds the choice (`ARCHITECTURE_CANON.md §CQRS/§UoW`): commands change state **through the aggregate**; mutating use cases use **UoW**; **no** `repository.update({field})`; queries never mutate.

### Option A — route `UpdatePostStatusStep` to `POST_COMMANDS.PUBLISH_POST`

- **Effort**: Medium-High (not the "small" the DoD implies).
- **Pros**: reuses an existing command name.
- **Cons / blockers**: `PublishPostCommandHandler` **does not transition state today** (§3) — it would need a rewrite. Semantically it is a _start-publish fan-out_ (per-channel jobs), not a post-pivot _finalize-to-PUBLISHED_; overloading it conflates two saga phases. And it still hits the `DRAFT→PUBLISHED` machine gap (§1.6). The DoD parenthetical "PUBLISH_POST ya valida" is **inaccurate** — it validates `!=PUBLISHED` but performs no transition. **Not recommended.**

### Option B — dedicated status-transition use case with OCC (RECOMMENDED)

Introduce a mutating use case in `packages/core/posts/` (e.g. `FinalizePostPublishingUseCase`, taking a success flag; or a pair `MarkPostPublishedUseCase` / `FailPostPublishingUseCase`) invoked via a well-named command (new `POST_COMMANDS.FINALIZE_PUBLISH` or similar). It:

1. loads the aggregate,
2. performs the **two-hop transition inside one UoW** — `post.startPublishing(providers)` then `post.markAsPublished(providerResults)` (or `markAsFailed`) — reusing the already-correct (currently dead) aggregate methods, which set `publishedAt` and emit `PostPublished`/`PostPublishingFailed` (→ outbox),
3. honors OCC via `expectedVersion` (as `UpdatePostUseCase` already does, `UpdatePostUseCase.ts:113-120`).

- **Effort**: Medium.
- **Pros**: canon-clean (aggregate-driven, UoW, no field-poke); reuses tested domain methods; keeps the FSM intact (no `DRAFT→PUBLISHED` canon amendment); the `PostPublished` event finally flows to analytics/outbox; wires the dead domain path.
- **Cons / decisions**: needs a new command + schema + handler + DI wiring; the two-hop bumps version twice — the design must load-once/save-once (or reconcile the OCC token math) so `expectedVersion` semantics stay coherent.

**Recommendation: Option B**, two-hop through `PUBLISHING` (no canon amendment). The alternative — amending `VALID_TRANSITIONS` to allow `DRAFT→PUBLISHED` — is an ADR-level change to the domain FSM and erases the `PUBLISHING` state's meaning; prefer the two-hop.

**Is OCC/version needed?** **Yes.** A manual edit (which bumps version via `updateContent`) between Create and finalize would otherwise be lost. The step already threads `expectedVersion` from `createData.version` (`saga.ts:900-901`). Keep OCC. **Caveat to resolve in design:** the **existing-draft path records no `version`** (`CreatePostStep` `skippedCreation` branch, `saga.ts:520-525`), so `expectedVersion` is `undefined` there and only the repository-level guard applies — a real OCC gap for reused drafts.

## 6. Adjacent smells (report-only; each with disposition)

1. **Phantom hardcoded versions** — `PostCommandHandlers.ts:264-265,298` (`previousVersion:1/newVersion:2/version:2`). _Disposition:_ fix in-scope if the handler is touched, else new SMELL.
2. **Schema advertises unsupported fields** — `UpdatePostCommandSchema` promises `status` (`cqrs.ts:206`) and `mediaIds` the handler drops (`PostCommandHandlers.ts:214-225`). _Disposition:_ remove the fields from the schema or make the handler honor them; SMELL if out of scope.
3. **`PublishPostCommandHandler` name/DoD mismatch** — implies a state transition but persists nothing (`PostCommandHandlers.ts:325-472`). _Disposition:_ clarify/rename or fold into the Option-B design.
4. **Unreachable `FAILED` branch** — `UpdatePostStatusStep` computes `newStatus = publishingSuccess ? "PUBLISHED" : "FAILED"` (`saga.ts:891`), but `WaitForPublishingCompletionStep` returns `failed` when `status.failed > 0` (`saga.ts:829-834`), so the saga fails at the wait step and the promotion step never runs for partial failure. The `FAILED` promotion is dead. _Disposition:_ resolve alongside the fix (partial-failure modeling, see §7.5).
5. **Dead domain publishing path** — `startPublishing/markAsPublished/markAsFailed` unwired (§1.5), and the entire `PUBLISHING` state is never produced at runtime. _Disposition:_ Option B wires it; otherwise flag as dead code.
6. **Double-unguarded re-publish** — both guards (`SagaIntegration.ts:428`, `PostCommandHandlers.ts:362`) depend on a status that never advances (§2). _Disposition:_ resolved implicitly by the fix; the integration test should assert re-publish is rejected after a successful publish.

## 7. Open questions for the pre-propose product gate

1. **Transition mechanism**: synchronous command from the saga step (current architecture; recommended) vs an event/outbox projection. The `PostPublished` domain event already exists and would flow through the use case's dispatcher/outbox — is that the intended downstream, or is a separate integration event required?
2. **DB migration**: none needed for the `Post` table (`status`/`publishedAt` columns already exist — the fixtures write them). Confirm no schema change unless the state machine is amended (code-only). Is that acceptable?
3. **Data-repair**: are there production rows with `publish_log` `OK` but `Post.status=DRAFT` (posts published under the buggy path)? If prod is live, a one-off reconciliation/backfill from `publish_log` may be required. How many rows, and is a repair script in scope for this change?
4. **FSM policy**: two-hop `DRAFT→PUBLISHING→PUBLISHED` inside one UoW (recommended, no canon change) vs an ADR to allow `DRAFT→PUBLISHED` directly. Which does the team want?
5. **Partial-failure semantics** (adjacent, may be scoped in or out): when some channels succeed and others fail, the current wait step fails the saga and leaves the post `DRAFT` while real channels published. Target status for partial success — `PUBLISHED`, `FAILED`, or a new partial state? This is a product decision beyond strict N-COR-1 but exposes the same "DB does not reflect reality" class.
