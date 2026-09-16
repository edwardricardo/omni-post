# Tasks: post-publish-status-integrity (N-COR-1)

**Inputs**: `specs/post-publish-status-promotion/spec.md` (R1–R10, 8 merge-blocking, **32 scenarios** —
re-counted in the verify corrective with the native rule, `grep -c '^#### Scenario:'` = 32 against
`grep -c '^### Requirement:'` = 10; the "33" written here at tasks time was one too many) ·
`design.md` rev 2 (D1–D11, gate PASS-WITH-WARNINGS: 5 WARNINGs folded below) · `proposal.md` ·
`pre-propose-decisions.md` (Q1–Q5 signed, honoured verbatim).
**Branch**: `workstream/post-publish-status-integrity` (tip = `origin/main` `31e2a2ad`). **Store**: openspec.
**Mode**: Strict TDD ACTIVE. Runner `pnpm --filter @apps/api test` (vitest units) ·
`pnpm --filter @apps/api test:integration` (node:test, needs `pnpm db:up`) · core units via `turbo run test`.
**Delivery**: `ask-on-risk` / `stacked-to-main`. **Forecast at §Review Workload Forecast — Edward decides there before apply.**

## Decisions already taken — apply does NOT re-open these

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                              | Source         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| A1  | `UnitOfWork.executeResultInTransaction` (D10) is **IN SCOPE** for this change, with an ADR.                                                                                                                                                                                                                                                                                                                                                           | Edward, signed |
| A2  | The ADR is **`docs/technical/ADR-0023-unit-of-work-result-aware-transaction.md`** — verified next free number (0001–0022 exist; `ADR-0020` is a pre-existing duplicated number, see backlog B7, and is NOT reused).                                                                                                                                                                                                                                   | Measured       |
| A3  | The fitness #4 **billing** remove-when (15 throws in `GatewayBillingService.ts` / `TrialManagementService.ts`) is **DEFERRED** to its own change. This change only updates the comment that names the remove-when.                                                                                                                                                                                                                                    | Edward, signed |
| A4  | `PostPublishingStarted` stays **internal** (D9): outbox row written, outbound mapping deleted.                                                                                                                                                                                                                                                                                                                                                        | Design D9      |
| A5  | The use case takes **no** `EventDispatcher` (D11); the outbox relay is the only delivery path.                                                                                                                                                                                                                                                                                                                                                        | Design D11     |
| A6  | Comment/JSDoc language for all new code: **English** (CODING_STANDARDS §Comment Quality Rules). The existing Spanish JSDoc on `UnitOfWork` (`Repository.ts:164-180`) is a pre-existing deviation — **do not rewrite it here** (backlog B8); the new member's JSDoc is English.                                                                                                                                                                        | Canon          |
| A7  | **Design Open Question 2 — RESOLVED.** R7's merge-blocking `[integration]` proof runs in the **engine-harness** suite (`integration:saga-recovery`, in the PR CI job), invoking `SagaIntegration`'s start path directly. `integration:saga-live` (`run-tests.sh:397`, needs `pnpm dev`) carries only the HTTP 400 shape as a secondary. A merge-blocking proof that only runs in a tier CI does not execute is not a proof (fitness #30's principle). | This phase     |

## Design-gate WARNINGs — where each is discharged

| W   | Subject                                                                                                                                                                                                                                                                                                                               | Task                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| W-A | New JSDoc must be a **multi-line** block or fitness #4 leaves hard-zero                                                                                                                                                                                                                                                               | T1.2, proven by T1.3 |
| W-B | Test-double inventory is **52 files / 53 definition sites** (MEASURED shape-agnostically after the corrective; NOT 24, and NOT the pre-corrective 50/55 — that number came from a `executeInTransaction\s*:` regex blind to method and property shorthand); **NO site is compiler-safe** — no `*.test.ts` is in any typecheck program | T1.6, T1.7, T1.8     |
| W-C | `FAILED` is a legal promotion origin (`PublishStatus.ts:46-50`) vs R5 prose                                                                                                                                                                                                                                                           | T2.4, T2.5           |
| W-D | R10's "a scheduled or draft saga promotes nothing" is untested                                                                                                                                                                                                                                                                        | T3.12                |
| W-E | D10 residual: a deterministic JS-side save failure now fails the saga post-pivot                                                                                                                                                                                                                                                      | T3.16                |

## Requirement → task traceability

| Req | Subject                                                                 | Merge-blocking | Tasks                                    |
| --- | ----------------------------------------------------------------------- | -------------- | ---------------------------------------- |
| R1  | Total success reaches PUBLISHED, one transaction, through the aggregate | YES            | T1.1–T1.5, T2.1, T2.6, T2.7, T3.9, T3.10 |
| R2  | Publishing-started delivery is DECIDED                                  | YES            | T3.5, T3.6, T3.10, T3.17                 |
| R3  | Command carries the outcome; non-total is REFUSED                       | YES            | T2.2, T2.12, T3.1, T3.3, T3.4            |
| R4  | Re-application is idempotent                                            | YES            | T2.3, T3.11                              |
| R5  | OCC honoured, idempotent answer resolved FIRST                          | YES            | T2.4, T2.5, T2.7                         |
| R6  | Content-update command can no longer carry a status                     | YES            | T3.2, T3.7                               |
| R7  | Persisted terminal status makes the re-publish guards effective         | YES            | T3.14, T3.15, T3.21                      |
| R8  | Promotion runs in the saga tenant scope, refuses unscoped               | no             | T2.6, T3.13                              |
| R9  | Saga step stays a thin emitter                                          | no             | T3.1, T3.3, T3.4, T3.12                  |
| R10 | The proof runs in CI; lock-in tests stop enshrining the defect          | YES            | T3.1, T3.2, T3.8, T3.18, T3.19, G-e      |

---

# PR 1 — The transaction seam: `executeResultInTransaction`

**Boundary.** Starts at `31e2a2ad`. Delivers the additive `UnitOfWork` port member, its Prisma
implementation, the ADR, the canon paragraph, the fitness #4 comment, and the whole test-double
sweep. Finishes with main green and **behaviour unchanged for every existing caller** — no use case
calls the new member yet. Rollback: revert the PR; nothing depends on it.

## WU1 — Port extension + adapter + sweep

- [x] **T1.1** _(RED)_ Extend `apps/api/tests/unit/infrastructure/PrismaUnitOfWork.test.ts` with four cases for `executeResultInTransaction`, written BEFORE the implementation: (a) callback resolves `err(E)` → the mock `$transaction` callback **rejects** (rollback observed) and the method returns **the same `err` object** (assert identity, not shape); (b) callback resolves `ok(v)` → commit, `ok(v)` returned; (c) callback throws a genuine `Error` → it propagates unchanged and is NOT converted to an `err`; (d) the GUC binding statement is emitted as the first statement, exactly as `executeInTransaction` does (`PrismaUnitOfWork.ts:83-94`). Record the natural RED in apply-progress.
- [x] **T1.2** Add `executeResultInTransaction<T, E>(fn: () => Promise<Result<T, E>>): Promise<Result<T, E>>` to the `UnitOfWork` interface (`packages/core/domain/src/repositories/Repository.ts:173-182`). **ACCEPTANCE (W-A, non-negotiable): the JSDoc MUST be a multi-line `/** … *​/` block**, every prose line beginning with `*`. A single-line `/** … a throw propagates. *​/` containing the word "throw" takes fitness #4 off hard-zero, because #4's comment filter excludes lines starting `*` or `//` but **not** `/**`. JSDoc in English (A6); `executeInTransaction` is left byte-untouched.
- [x] **T1.3** _(PLANTED RED — proves T1.2's acceptance rather than asserting it)_ Rewrite the new JSDoc as a single line containing "throw", run fitness #4, observe the count go to **1**; restore the multi-line form byte-exact (verify with `cmp`/checksum), re-run, observe **0**. Record both measured counts in apply-progress.
- [x] **T1.4** Implement `executeResultInTransaction` in `PrismaUnitOfWork` (`apps/api/src/infrastructure/unitofwork/PrismaUnitOfWork.ts`) **on top of `executeInTransaction`** — one infrastructure-private sentinel error thrown inside the existing `$transaction` and unwrapped outside. Constraints: no second `$transaction` call (fitness #40 Part A allowlist — this file is a named seam, keep it at its current call count), same GUC binding, same AsyncLocalStorage marker, `executeInTransaction` unchanged. The sentinel is private to the module and never escapes.
- [x] **T1.5** Green T1.1; confirm `tsc -b apps/api packages/core/domain` is clean apart from the double failures T1.6 exists to fix.
- [x] **T1.6** _(W-B — sweep; the "compiler-driven half" DOES NOT EXIST — see apply-progress: no `*.test.ts` is in any typecheck program, measured)_ Run `tsc -b` across the workspace and add `executeResultInTransaction: async (fn) => fn(),` to every failing `UnitOfWork` double. **Final measured inventory: 53 definition sites across 52 test files**, taken shape-agnostically per the corrected T1.8 gate. The design's "24 passthroughUow" is wrong, and so is the pre-corrective "55 sites / 50 files" — that figure came from `executeInTransaction\s*:`, a regex blind to method and property shorthand; **neither number may be used as the completion signal**. `PrismaUnitOfWork` is the only production implementer (`:54`); no non-test file defines a double.
- [x] **T1.7** _(W-B — sweep, NOT compiler-safe half)_ Hand-update the **7 cast sites**, which will NOT raise a tsc error if left stale and would hand a future caller `undefined`:
  - `packages/core/accounts/tests/unit/RestoreAccountUseCase.test.ts:72` (`as UnitOfWork`)
  - `packages/core/accounts/tests/unit/HardDeleteAccountUseCase.test.ts:87` (`as unknown as UnitOfWork & …`)
  - `packages/core/accounts/tests/unit/DeleteAccountUseCase.test.ts:82` (`as UnitOfWork`)
  - `packages/core/projects/tests/unit/RestoreProjectUseCase.test.ts:98` (`as UnitOfWork`)
  - `packages/core/projects/tests/unit/HardDeleteProjectUseCase.test.ts:111` (`as unknown as UnitOfWork & …`)
  - `packages/core/projects/tests/unit/DeleteProjectUseCase.test.ts:97` (`as UnitOfWork`)
  - `packages/core/bulk-scheduling/tests/unit/ConfirmBulkScheduleUseCase.test.ts:77` (`as unknown as UnitOfWork`)
- [x] **T1.8** _(sweep completion gate — the count is the signal, not "tsc is green"; **CORRECTED after the gatekeeper caught this gate lying**)_ The original gate compared `executeInTransaction\s*:` against `executeResultInTransaction\s*:` and expected 55 sites / 50 files. **That gate is BLIND and must never be used again**: a colon regex sees only `key: value` members, so it missed a **method-shorthand** double (`async executeInTransaction<T>(fn) { … }` in `apps/api/tests/unit/unitOfWork.useCases.test.ts`) and a **property-shorthand** one (`const executeInTransaction = …; { executeInTransaction }` in `apps/api/tests/unit/application/listening/DispatchMentionSearchUseCase.test.ts`), then reported the sweep complete with both still missing the member. The sound gate is a **set difference over FILES**: `A` = files matching `executeInTransaction` in `**/*.test.ts`; `B` = files matching `executeResultInTransaction`; `C` = files matching `new PrismaUnitOfWork` (real-UoW CALLERS, not doubles). Require **`(A \ B) \ C` = ∅** and record `B \ C`. **Measured after the corrective: 52 double files / 53 definition sites; `(A \ B) \ C` = 0; `A \ B` = the 5 real-UoW caller suites, correctly excluded.**
- [x] **T1.9** Run the full unit tier (`pnpm --filter @apps/api test` + `turbo run test`) and confirm **zero behaviour change**: every pre-existing suite green, no assertion edited to accommodate the new member.

## WU2 — Governance: ADR, canon, fitness comment

- [x] **T1.10** Write **`docs/technical/ADR-0023-unit-of-work-result-aware-transaction.md`** using ADR-0001's template (Status / Date / Deciders / Context / Decision / Rationale / Alternatives / Consequences / Revisit if / Risks / References). Content it must carry, not paraphrase: the **hole** (`PrismaPostRepository.save()` catches everything into `err` at `:84-98`; `doUpdate` is multi-statement, `:684` → `:712` → `:731-773` → `:776`; a JS-side failure after the first statement returns an `err` the canon `let result` pattern hands back as a value, so Prisma COMMITS a partial write — R1's forbidden state); why database-level failures are NOT the exposure (Postgres aborts them already); the three rejected alternatives with their reasons (`save()` rethrowing = instance fix + designed cross-boundary throw; an `abort()` token = a throw wearing a method name; changing `executeInTransaction` in place = silently altering ~56 existing callers); that this is **fitness #4's own documented remove-when** (`fitness.yml:151`); and that the billing migration is explicitly **deferred** (A3, backlog B1). Deciders: Edward.
- [x] **T1.11** Add ONE paragraph to `docs/architecture/ARCHITECTURE_CANON.md` §Unit of Work sanctioning the Result-aware form as a **second** shape (when the work returns a `Result` whose `err` must abort the transaction), linking ADR-0023, and stating that `executeInTransaction` remains correct for throw-based work. Do not restate the whole pattern; do not delete the existing §UoW Rules bullets.
- [x] **T1.12** **DONE 2026-09-15 — both #4 mirrors agree.** `CLAUDE.md` §#4 AND `.github/workflows/fitness.yml:147-151` now both state the remove-when is MET (ADR-0023), billing migration named as a separate change; applied by the orchestrator under a `sensitive-edit` token, comment-only, #4 regex byte-unchanged. Historical blocker context below:** The pre-edit hook refuses `/.github/workflows/` without a `sensitive-edit` token: _"pedíle a Edward que ejecute `omnipost-allow sensitive-edit` (TTL 15 min)"_. The exact replacement text is carried in apply-progress; PR 1 MUST NOT be committed as complete while the two mirrors disagree — that is the doc/workflow drift this task exists to prevent. Original text: Update the fitness #4 remove-when comment in **both** mirrors — `CLAUDE.md` §Automated Compliance Checks (#4 exception list) and `.github/workflows/fitness.yml:147-151` — to say the remove-when is now MET and that migrating the 15 billing throws is a named separate change (A3). **Comment only: the regex is byte-unchanged, so no red-path proof is owed.** The two mirrors must stay textually in sync (the doc/workflow drift failure mode CLAUDE.md names).
- [x] **T1.13** Run fitness #4 and confirm the count is **0** and the exception list gained no name. _(Measured 0; the exception list is byte-unchanged — only its remove-when prose moved, and only in the CLAUDE.md mirror so far. Re-run after T1.12's workflow half lands.)_

---

# PR 2 — The promotion: use case, command, handler, DI

**Boundary.** Starts at PR 1's merge. Delivers `CompletePostPublishingUseCase`, the
`post.complete-publishing` command **(addition only)**, its handler, and the DI wiring.
Finishes with main green and **behaviour unchanged**: nothing emits the new command yet, so
publish-now still exhibits the defect. That is deliberate — see the ordering constraint below.

> **ORDERING CONSTRAINT (load-bearing, do not reorder).** The `status` removal + `data.strict()` on
> `UpdatePostCommandSchema` (D6) must land in the **same PR as the saga-step rewrite**, i.e. PR 3.
> `saga.ts:903-919` builds a generic `Command` — removing `status` from the _Zod schema_ is a RUNTIME
> `unrecognized_keys` rejection for that producer, not a compile error. Shipping D6 in PR 2 would
> leave main with a publish-now saga whose status command is rejected at validation between the two
> merges. Under `stacked-to-main` every PR must leave main sound, so D6 travels with its producer.

## WU3 — `CompletePostPublishingUseCase` (the single writer)

- [x] **T2.1** _(RED)_ Create `packages/core/posts/tests/unit/CompletePostPublishingUseCase.test.ts` with mock-port factories modelled on `CreatePostUseCase.test.ts`. Doubles are of the **ports**, never of the use case under test. All of T2.2, T2.3, T2.4, T2.6 and the test half of T2.8 are written here BEFORE the implementation lands in T2.7; record the natural RED.
- [x] **T2.2** _(RED)_ Pure-refusal cases, all asserting **zero repository calls**: invalid `postId` → `VALIDATION_FAILED`; `channels: []` → `VALIDATION_FAILED` (**W2 — the emptiness guard must precede the totality check, because `[].every()` is `true`**; "a vacuous total is not a publish", R3); any `success === false` → `NOT_IMPLEMENTED` naming N-COR-2 (R3).
- [x] **T2.3** _(RED)_ Idempotency (R4): a post already `PUBLISHED` → `ok({ applied: false })`, **zero saves**, zero events, and `publishedAt` asserted **equal to the fixture value** (`2024-01-01T…`), never `now` — an assertion over two identical values cannot distinguish preserved from overwritten.
- [x] **T2.4** _(RED)_ Ordering + OCC (R5): stale `expectedVersion` on a **DRAFT** post → `CONFLICT`, nothing written; stale `expectedVersion` on an **already-PUBLISHED** post → **success, not `CONFLICT`** (the already-published check resolves FIRST); no token supplied → the persisted status decides. **W-C origin cases:** `CANCELLED` origin → `FORBIDDEN` (`PublishStatus.ts:51` allows only `→ DRAFT`); **`FAILED` origin → SUCCEEDS**, because `PublishStatus.ts:46-50` makes `FAILED → PUBLISHING` legal.
- [x] **T2.5** _(W-C — resolve the spec/FSM tension in writing, do not let the code decide it silently)_ Add a short subsection to `design.md` §Residuals stating which reading governs: **the FSM governs** — a post the provider genuinely published is truthfully `PUBLISHED` even if another path had marked it `FAILED`, and R5's prose ("a post that has since … failed … is never promoted") is about the _tokenless_ refusal set, not about overriding a legal FSM edge. Name it in the PR 2 body too, so the divergence is adjudicated rather than discovered later.
- [x] **T2.6** _(RED)_ Transaction semantics: the UoW double records that **every `err` was returned from inside the callback** (pattern: `apps/api/tests/unit/unitOfWork.useCases.test.ts`) — `save()` returning `err(VersionConflictError)` → `CONFLICT`; any other `save()` err → `INTERNAL_ERROR`; **both narrowed on the Result, never caught** (S2), both reaching the caller through `executeResultInTransaction` so the transaction aborts. Tenant negative (R8): a thrown `TenantContextMissingError` → classified, error Result, nothing written.
- [x] **T2.7** Create `packages/core/posts/src/CompletePostPublishingUseCase.ts`. Order is fixed by the design and is not an implementation detail: _before the UoW, no I/O_ → invalid id · empty channels · non-total. _Inside `executeResultInTransaction`_ → `findById` (`NOT_FOUND`) · `isPublished` → `ok({applied:false})` · `expectedVersion` compare (`CONFLICT`) · resolve providers (D7) · `isPublishing ? skip : startPublishing(providers)` · `markAsPublished(byChannel)` · `save()` with the two-way err narrowing · `clearDomainEvents()` · `ok`. _Outer `try/catch`_ → `classifyPersistenceFailure` (`UseCase.ts:143-152`, precedent `RestoreProjectUseCase.ts:65-76`). Constructor `(postRepository, channelRepository, unitOfWork?)` — UoW **last and optional** per canon; **no `EventDispatcher`** (A5/D11). JSDoc `@file`/`@description`/`@layer application` (#9/#10); no phase or sprint reference (#8); no raw `throw` (#4); no framework import (#2); no `any` (#3).
- [x] **T2.8** _(RED→GREEN)_ Provider resolution (D7): each `channelId` → `ChannelRepository.findById` → `provider.type`, deduplicated; unresolvable channels collected into `unresolvedChannelIds`, **never blocking** the promotion (S4 — totality is decided from the outcome, not from resolution). One test: an unresolvable channel still promotes and reports the id.
- [x] **T2.9** Export from `packages/core/posts/src/index.ts`.
- [x] **T2.10** Confirm the core unit suite is reached by `turbo run test` (new files under `packages/core/*/tests/unit/` are collected by construction — verify the run names the new file, do not assume it).

## WU4 — Command contract (additive), handler, DI

- [x] **T2.11** _(RED)_ Create `apps/api/tests/unit/PostCommandHandlers.complete-publishing.test.ts`: schema acceptance/rejection (unknown key → `unrecognized_keys` via `.strict()`; `channels` `.min(1)`); delegation to the use case with the outcome forwarded verbatim; **one user-action audit event only when `applied === true`**; cache invalidation keys matching the update handler; the **real** version returned (never a hardcoded one); the `FAILED`-origin case from T2.4 surfacing as success through the handler.
- [x] **T2.12** Add to `packages/shared/src/cqrs.ts` — **addition only, no removal in this PR**: `POST_COMMANDS.COMPLETE_PUBLISHING`, `CompletePostPublishingCommandSchema` (shape per design §Interfaces: `data.strict()`, `outcome.channels` `.min(1)`, optional `expectedVersion`), and the derived type.
- [x] **T2.13** Add `CompletePostPublishingCommandHandler` to `apps/api/src/cqrs/handlers/PostCommandHandlers.ts` (config field + factory wiring). **No `EVENT_TYPES.POST_PUBLISHED` CQRS integration event** (D8 — the schema needs `externalId`, which is N-COR-2); domain events reach consumers through the outbox only. No `prisma.*` in the handler (#6).
- [x] **T2.14** DI: `TOKENS.CompletePostPublishingUseCase` in `apps/api/src/infrastructure/container/types.ts`; singleton registration in `setupPostUseCases.ts` with `PostRepository`, `ChannelRepository`, `UnitOfWork` (**no dispatcher**, D11). Composition root only (#21/#22).
- [x] **T2.15** Pass the use case into `createPostCommandHandlers` at `apps/api/src/index.ts:714`.
- [x] **T2.16** Add the new use case's mock to `apps/api/tests/unit/PostCommandHandlers.test-helpers.ts` so existing handler suites keep compiling. **Do not touch the `status` builder or the phantom `version: 2` here** — those belong to PR 3 (T3.2).
- [x] **T2.17** Dead-code gate: run `knip` and confirm green — the handler is registered on the bus and the use case is resolved from the container, so neither is unreachable even though no producer emits the command until PR 3. If knip disagrees, report it rather than adding an ignore.

## WU4-C — PR-2 gatekeeper corrective (PASS-WITH-WARNINGS, 0 CRITICAL)

Scope held to the five named findings; no PR-3 work pulled forward, `saga.ts` /
`UpdatePostCommandSchema` / the `PostPublishingStarted` catalog / every integration suite untouched.

- [x] **T2.18** _(W1 — phantom completion)_ The handler case named _"reports success for a promotion whose origin was FAILED — the use case decides the FSM, not the handler"_ claimed an FSM proof its body never exercised: it set `applied`/`version` on a MOCK use case, with no FAILED origin anywhere in the handler path, and duplicated the real-version case beside it. Renamed to what it actually proves — the handler forwards an applied promotion as a success carrying `applied: true` — and its `version` assertion dropped, since the neighbouring case owns that half. The genuine FSM proof stays where it belongs, in the core suite.
- [x] **T2.19** _(W2 — the CAS-conflict proof gap, RED→GREEN)_ `saveResult.error instanceof VersionConflictError` was the ONLY `instanceof` narrowing of a domain error across the core↔adapter boundary in `packages/core` (measured tree-wide). `@core/domain` ships a dual conditional export (`development` → src, `default` → dist), so two module copies mean two constructors and the narrowing silently downgrades every conflict to `INTERNAL_ERROR` while green. Exported `VERSION_CONFLICT_CODE` from `DomainError.ts` (the class now uses it, so there is one source), narrowed on the code, and added a unit case feeding the use case a DIFFERENT class carrying that code. **Natural RED measured: `CONFLICT` expected, `INTERNAL_ERROR` received.**
- [x] **T2.20** _(W3 — make "no I/O before the UoW" executable, PLANTED RED)_ The three pure-refusal cases asserted zero repository calls but never `uow.calls === 0`, so an opened-empty transaction would have passed all three. Added the assertion, then planted one (`executeResultInTransaction` opened before the guards): **4 real failures** — the three new assertions plus the "one transaction" case seeing 2. Restored byte-exact, sha256 `a880065be18f87c5d06efa4ab74ed15b96e4dd45f279d72ae64a56da8b4fbf9e` before and after, suite back to green.
- [x] **T2.21** _(S2 — the other half of the refusal set, PLANTED RED)_ The design names `CANCELLED` **and** `PENDING_REVIEW` as R5's tokenless refusals; only `CANCELLED` had a case. Added the `PENDING_REVIEW` → `FORBIDDEN` case and proved it bites by planting `PENDING_REVIEW → PUBLISHING` into the FSM: **1 real failure**. Restored byte-exact, sha256 `0788738fcc26bf9b406940e76d5885dbd788506fcb3fb279c14ee1d438ab3ae8` before and after.
- [x] **T2.22** _(S4 — resolution moved under the branch, RED→GREEN, **not the free change it looked like**)_ `resolveProviders` ran unconditionally, spending one sequential channel read per channel inside the interactive transaction even when `isPublishing` made the providers unused. Moved inside `!post.isPublishing`. **It is not purely a perf move:** `unresolvedChannelIds` is read on BOTH paths, so skipping resolution makes it `[]` on the already-PUBLISHING path. That is honest only because the field means "channels the started event could not name" and no started event is emitted there — so the field's JSDoc now says exactly that, and a unit case pins both halves (**natural RED measured: 2 channel reads where 0 are needed**).

---

# PR 3 — Wiring the fix: forwarder, class closure, and the proof

**Boundary.** Starts at PR 2's merge. Delivers the saga-step rewrite, the pivot's `channelIds`, the
`status` removal + `.strict()` class closure, the D9 catalog change, the integration proof, the
lock-in rewrites, and the docs. **This is the PR where the defect closes.** Rollback: revert this PR
and the saga returns to the prior routing with no data-shape change.

## WU5 — Step becomes a forwarder; outcome becomes observable

- [x] **T3.1** _(RED)_ Rewrite `apps/api/tests/unit/sagaDeterministicIds.test.ts` for the new step: id stays `cmd-{sagaId}-update-post-status` (#7); the emitted command is `post.complete-publishing` carrying the outcome built from `stepData`; **no `expectedVersion` is forwarded** (D4). Then one refusal case per D1 precondition, each asserting **`outcome: "failed"` with a named reason and NO command emitted**: missing `metadata.accountId`; missing `channelIds` (a saga persisted before this change); `channelIds.length !== jobIds.length`; `publishingComplete !== true`; `failed !== 0`; `completed !== totalJobs`; `channelIds.length === 0`. The current test's double returns success for a command the handler drops — that shape must be gone (R10).
- [x] **T3.2** _(RED)_ Rewrite `apps/api/tests/unit/PostCommandHandlers.update.test.ts`: a `post.update` carrying `status` now fails validation with `unrecognized_keys`; no branch logs-and-drops it; the phantom hardcoded `version: 2` assertion is **not** re-pinned (R10).
- [x] **T3.3** Rewrite `UpdatePostStatusStep` (`packages/shared/src/saga.ts:865-946`) as a thin forwarder: delete the `newStatus = publishingSuccess ? "PUBLISHED" : "FAILED"` expression (`:891`) and the `expectedVersion` forwarding (`:900-901`); emit `post.complete-publishing` with `channels: channelIds.map(id => ({ channelId: id, success: true }))`; fail closed on every D1 precondition before emitting. **The `mode === "draft" || "schedule"` short-circuit at `:876-878` survives byte-identically** — it is R10's guarantee and T3.12's subject.
- [x] **T3.4** Add `channelIds` to `ScheduleStepData` and record it at the pivot (`saga.ts:~720`), **index-aligned with `jobIds`, same order**; type `CompletionStepData`; correct the stale wait-step comment at `:823-826`. A unit case asserts the pivot records the ids it actually enqueued (R3 `[static]`: the outcome is decided from channels scheduled, not from a count).
- [x] **T3.5** _(RED)_ Update `apps/api/tests/unit/integrationEventDeliveryHandler.test.ts`: the catalog carries **no** `PostPublishingStarted` entry, and `handle(PostPublishingStarted)` never calls `fire` (D9).
- [x] **T3.6** Delete `PostPublishingStarted: "post.publishing_started"` from `INTEGRATION_EVENT_NAMES` (`apps/api/src/integrations/IntegrationEventDeliveryHandler.ts:33`) with a comment naming **why** (counterfactual timing + best-effort `Promise.allSettled` fan-out with no per-subscription retry, so the "never started-without-published" invariant cannot be guaranteed across two independently delivered rows). `HANDLED_EVENT_TYPES` derives from the keys, so boot registration shrinks with it; the outbox row is still written and `EventSchemaRegistry.ts:145` keeps v1.
- [x] **T3.7** Remove `status` from `UpdatePostCommandSchema` and add `data.strict()` (`packages/shared/src/cqrs.ts`); delete the warn-and-drop branch at `apps/api/src/cqrs/handlers/PostCommandHandlers.ts:220-225`. Re-verify the sole-producer claim **before** deleting (`saga.ts:905` was the only one at `31e2a2ad`) — the removal's soundness rests on it, and R6 makes the verification part of the evidence, not an assumption.
- [x] **T3.8** Update `apps/api/tests/unit/PostCommandHandlers.create.test.ts` — the comment at `:43` is no longer true.

## WU6 — The integration proof (merge-blocking DoD)

- [x] **T3.9** _(RED — this is the dangerous red: it currently fails by REPORTING SUCCESS)_ Create `apps/api/tests/integration/sagaPublishNowPromotion.test.ts` on an engine harness modelled on `sagaCrashRecovery.test.ts:342-384` (`buildHarness`), with the **real** `PrismaPostRepository` + real `OutboxWriter` and `checkJobsStatus` stubbed to all-completed. Case 1 (R1): `status = PUBLISHED`, `publishedAt` non-null, `version = seed + 1`, outbox holds `PostPublishingStarted` **and** `PostPublished` (keys = channel ids), saga `COMPLETED`. **W4: the seeded post carries valid media and content, and both are asserted byte-identical after the promotion** — R1 forbids the promotion writing any field beyond status/timestamp/bookkeeping.
- [x] **T3.10** Case 2 (R1 all-or-nothing / R2 `[integration]`, the C2 proof): a second repository built with a failing `OutboxWriter` double whose `writeEvents` throws **after** `tx.post.update` succeeded → the use case returns `err`, and the row reads `DRAFT` / `publishedAt` null / seed version, with **no** outbox row of either type. This case is RED on the rev-1 design (which commits `PUBLISHED` with no event) and GREEN only with `executeResultInTransaction` — it is the reason PR 1 exists.
- [x] **T3.11** Case 3 (R4, W3a): re-execute the command after `publishedAt = P1`; assert `applied: false`, `publishedAt === P1`, **and `P1 < secondAttemptStartedAt`** so an overwrite would have been observable, outbox count unchanged. Plus the redelivered-completion case: the saga re-enters the step and still reaches `COMPLETED`, never `FAILED`. **Which half shipped when (verify C1):** the direct re-execution half landed in the original apply; the redelivered-completion half did NOT, and the row read `[x]` over it. It shipped in the verify corrective (2026-09-16) as `sagaPublishNowPromotion.test.ts` → "a completed saga whose promotion step is re-entered by a redelivered completion" (2 cases), which rewinds the saga row to the post-pivot promotion step, leaves the post PUBLISHED with P1, and resumes through `manager.continueSaga`.
- [x] **T3.12** _(W-D)_ Case 4 (R10 `[integration]`): run one saga in `schedule` mode and one in `draft` mode through the same harness; assert neither post is `PUBLISHED`, neither has a `publishedAt`, and **no `PostPublished` row exists for either** — the `:876-878` short-circuit survives the rewrite. Currently untested; this is the task that makes it a proof.
- [x] **T3.13** Case 5 (R8): the same command executed outside any tenant context → error Result, row unchanged.
- [x] **T3.14** _(A7 — R7's merge-blocking proof, in a CI-reachable tier)_ Case 6: after a successful promotion, start the publishing saga again for the same post **through `SagaIntegration`'s start path directly** (`SagaIntegration.ts:428-432`); assert it is rejected as a client error naming the non-DRAFT status **and that the publish queue received no new job** — the harm is a duplicate provider send, so the job count is the assertion, not the status code.
- [x] **T3.15** _(R7 unit half)_ Unit case: the publish command handler refuses a post whose persisted status is `PUBLISHED` (`PostCommandHandlers.ts:362` guard).
- [x] **T3.16** _(W-E)_ Add the D10 residual to `design.md` §Residuals in its true terms: with the transaction now aborting on a returned `err`, a **deterministic** JS-side save failure no longer commits a partial write — it retries to exhaustion and the saga FAILs **post-pivot**, leaving the post `DRAFT` while the provider holds it. That is the correct trade (a wrong committed state is worse than a visible failure), it is the same observable as W5's evicted-job path, and it is named here rather than discovered in an incident. Carry one line of it in the PR 3 body.
- [x] **T3.17** _(R2 `[static]`)_ The PR 3 body states the D9 decision explicitly — that `post.publishing_started` is **not** delivered to external subscribers, why, and that the timing is counterfactual (the hop runs after the provider published). `design.md` already carries it (D9); both must say it.
- [x] **T3.18** Register the new suite in `apps/api/scripts/run-tests.sh` — **exactly one** `run_batch`, appended to `integration:saga-recovery` (`:336`, `CONCURRENCY=1 TIMEOUT=120000`). Same work unit as the suite: a suite no batch names never executes while still reading as coverage (#30).
- [x] **T3.19** Re-measure fitness #30's unreached count and confirm it **has not risen** from the 21 baseline; report the measured number. Do not raise the baseline literal.
- [x] **T3.20** Update `apps/api/tests/integration/sagaCrashRecovery.test.ts`: `handlerConfig` (`:790`), register the new handler (`:356`), expectation (`:928`) → `["post.create", "post.complete-publishing"]`.
- [x] **T3.21** Extend `apps/api/tests/integration/sagaCustomerFlow.test.ts` publish-now: DB reads `PUBLISHED`; second `/start` → 400 naming the status; publish-queue job count unchanged (W3b). Secondary to T3.14 per A7 — this tier is not in the PR CI job. **APPLY DEVIATION, measured:** this tier seeds placeholder credential columns, so its publish jobs genuinely FAIL and a publish-now there never reaches a total success — the "DB reads PUBLISHED after a real publish-now" clause is unreachable here and a test asserting it could never pass. What was extended instead is the tier's existing already-PUBLISHED case: 400, the body NAMES the status, the row is unchanged, and the saga count for the account is unchanged (no saga started ⇒ no pivot ⇒ nothing enqueued). The direct job-count assertion is T3.14's, in the CI-reachable tier, per A7.

## WU7 — Docs

- [x] **T3.22** `docs/api/saga.md:284-288` — step 5 emits `post.complete-publishing` and, being **retryable**, has **no** `compensate`; the current text documents a compensation that does not exist (S5).
- [x] **T3.23** `docs/development/saga-test-suites.md` — add the new suite row with its batch.

---

## Standing guards (every work unit, every PR)

- **G-a** 0 error / 0 warning at the end of every PR: `pnpm lint --max-warnings 0`, `tsc -b`, the full fitness suite, the unit tier, and the integration tier the PR touches. No failure is deferred as "pre-existing" or "out of scope"; none is suppressed or threshold-raised.
- **G-b** Fitness at 0 for #2, #3, #4, #6, #7, #8, #9, #10, #21, #22, #30, #32, #38, #40. **#4's exception list gains no name** (that is D10's whole point). **#40 Part A**: `PrismaUnitOfWork` stays a named seam and does not gain a second `$transaction` call; **#40 Part B** floor (≥10 `withGucBoundTransaction` sites) unaffected.
- **G-c** No edit to `infra/prisma/schema.prisma` or `infra/prisma/migrations/**` (Q2 — any such edit is out of contract).
- **G-d** Every new/changed file carries `@file`/`@description`/`@layer` (#9/#10) and no sprint/phase reference (#8). New comments and JSDoc in English (A6).
- **G-e** Strict TDD: RED before GREEN for every behavioural task, with the **measured** failure recorded in apply-progress before the fix. Where a test necessarily follows its subject (T1.3), use the planted-red protocol: plant → observe a real non-zero failure → restore byte-exact (`cmp`/checksum) → re-confirm green.
- **G-f** Writers never run git. The orchestrator owns branch, commit, push, and PR creation; push requires `omnipost-allow push`; merge to main is always Edward's.

## Chain shape (each PR body carries this diagram, marking its own position with 📍)

```
main (31e2a2ad)
  └─ PR 1  UoW seam + ADR-0023 + canon + sweep      → merges to main
       └─ PR 2  use case + command + handler + DI    → merges to main
            └─ PR 3  forwarder + class closure + proof → merges to main  (defect closes here)
```

Each PR body states: start state, finished state, prior dependency, follow-up, out-of-scope, the
measured CODE/EVIDENCE split, and the rollback boundary.

---

## Review Workload Forecast

**Chained PRs recommended: YES**
**400-line budget risk: HIGH** (single-PR CODE ≈ 570, 1.4× the hard budget)
**Decision needed before apply: YES**

### CODE (production source only — 400 hard, per PR)

| PR       | Production files                                                                                                                                                               | Estimated CODE (add+del) | Basis                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PR 1** | `Repository.ts`, `PrismaUnitOfWork.ts`                                                                                                                                         | **~55**                  | one interface member + JSDoc (~14); adapter method + private sentinel + JSDoc (~40)                                                                  |
| **PR 2** | `CompletePostPublishingUseCase.ts` (new), `posts/index.ts`, `cqrs.ts` (add only), `PostCommandHandlers.ts` (add handler), `index.ts`, `container/{types,setupPostUseCases}.ts` | **~365**                 | use case ~240 (sibling `CreatePostUseCase.ts` ≈ 220, plus the ordered guard chain and provider resolution); schema+type ~35; handler ~72; wiring ~18 |
| **PR 3** | `saga.ts`, `cqrs.ts` (removal + `.strict()`), `PostCommandHandlers.ts` (delete `:220-225`), `IntegrationEventDeliveryHandler.ts`                                               | **~155**                 | step rewrite ~120 changed + pivot/`ScheduleStepData`/`CompletionStepData` ~20; removal ~10; catalog ~5                                               |
|          | **Total CODE**                                                                                                                                                                 | **~575**                 |                                                                                                                                                      |

> **MEASURED AT APPLY — the PR 2 forecast was WRONG and the claim below no longer holds.**
> PR 2's production source came in at **544 changed lines (544 add / 0 del)** against a ~365
> forecast and the **400 hard** budget — **36% over**. The two files that missed are the ones the
> forecast reasoned about least precisely: the use case at **336** (forecast ~240, extrapolated
> from `CreatePostUseCase.ts` ≈ 220 — but that sibling carries one guard, while this one carries
> an ordered chain of six plus a two-way `save()` narrowing and provider resolution), and the
> handler at **129** (forecast ~72). `cqrs.ts` 55 · `setupPostUseCases.ts` 16 · `posts/index.ts` 6
> · `container/types.ts` 1 · `apps/api/src/index.ts` 1.
>
> The work is written, green and gate-clean; what is NOT decided is how it ships. **Apply STOPPED
> here rather than choosing**, because the budget is Edward's one decision per change and because
> the two obvious ways to make the number smaller — deleting the mandated JSDoc (#9) or the
> comments that carry the guard-order reasoning — would buy the number by destroying the evidence.
>
> **The D7 split named as the remedy does not work, and that is measured, not assumed.** Removing
> provider resolution takes `resolveProviders` (30 lines), its imports, constructor parameter, DTO
> field and call-site plumbing (~10), and the handler's unresolved-channel WARN (6) — **~46 lines,
> landing PR 2 at ~498. Still 98 over.** Recommending it would have traded a real split for a
> number that still fails.
>
> **The split that does work is the work-unit boundary tasks.md already draws:**
>
> | Slice | Content                                                                                              | Measured CODE |
> | ----- | ---------------------------------------------------------------------------------------------------- | ------------- |
> | PR 2a | WU3 — `CompletePostPublishingUseCase.ts` (336) + barrel (6)                                          | **342**       |
> | PR 2b | WU4 — `cqrs.ts` (55) + handler (129) + `setupPostUseCases.ts` (16) + `types.ts` (1) + `index.ts` (1) | **202**       |
>
> **RE-MEASURED after the PR-2 gatekeeper corrective (W1/W2/W3/S2/S4).** The corrective added 32
> production lines to the use case (the `isVersionConflict` helper and its JSDoc, the resolution
> move, the `unresolvedChannelIds` JSDoc) and a new 2-file pair in `@core/domain` carrying
> `VERSION_CONFLICT_CODE` (15 + 1). PR 2b is byte-unchanged by the corrective.
>
> | Slice | Content                                                                                                    | Measured CODE |
> | ----- | ---------------------------------------------------------------------------------------------------------- | ------------- |
> | PR 2a | `CompletePostPublishingUseCase.ts` (368) + barrel (6) + `DomainError.ts` (+14/−1) + `errors/index.ts` (+1) | **390**       |
> | PR 2b | unchanged                                                                                                  | **202**       |
>
> **PR 2a now has 10 lines of headroom, and that is the number to watch.** If anything further is
> added to WU3, the `VERSION_CONFLICT_CODE` pair (`DomainError.ts` + `errors/index.ts`, **16 CODE**,
> zero behaviour change) is a self-contained additive domain slice that can ship as its own micro-PR
> ahead of 2a, which drops 2a to **374**. Named here so the relief valve is a decision already
> costed, not one improvised under the budget.
>
> Both are under 400, both leave main sound (nothing resolves the use case until 2b, nothing emits
> the command until PR 3), and each has its own rollback boundary. The one risk worth checking was
> whether WU3 alone trips the dead-code ratchet, since T2.17's whole argument is that the container
> registration is what makes the use case reachable. **Measured by planting it:** with the DI
> registration removed, `pnpm run check:dead-code` still reports **0 regressions** and raw `knip`'s
> findings are byte-identical — the barrel export is treated as the package's public API, so the
> registration is not load-bearing for that gate. Restored byte-exact (sha256
> `7a967b14…b9a5` before and after). Limit of the measurement, stated: only the DI registration was
> removed, not all of WU4, so this is strong evidence rather than a full PR-2a dry run.
>
> ~~Every PR is under the 400 hard budget. **No `size:exception` is requested or needed.**~~
> (PR 1 shipped at 77, measured. PR 3's ~155 is still a forecast and should be read with the same
> suspicion this row earned.)

> **MEASURED AT APPLY — PR 3, 2026-09-16.** CODE **258** (`saga.ts` 191 · `cqrs.ts` 36 ·
> `PostCommandHandlers.ts` 18 · `IntegrationEventDeliveryHandler.ts` 13) against the ~155 forecast:
> 67% over on its own, still under the 400 hard budget. EVIDENCE **1,577** for the slice against the
> ~710 forecast, plus **260** for `apply-progress.md` = **1,837**. Whole change ≈ **2,800** against
> the ratified hard stop of **2,000** — breached, reported rather than trimmed.
>
> **The ~710 was a method error, and naming it is the point:** it was extrapolated from sibling
> suites instead of sized file by file. An honest sizing would have counted the integration harness
> (552, plus 94 for the doubles split out of it), the six scenarios (306), the
> `sagaDeterministicIds` rewrite that D1's nine independent preconditions force to 275, and the two
> lock-in rewrites in `sagaCrashRecovery` — the same error this section already records for the PR 2
> use case, repeated one slice later on the evidence side.
>
> **Edward ACCEPTED the overshoot on 2026-09-16.** PR 3 ships complete, and PR 2 + PR 3 ship FOLDED
> into the single pull request on `workstream/post-publish-status-integrity-pr2`. Nothing was
> deleted from the proof to reach a number.

### EVIDENCE (tests + docs + PR bodies — pre-approved band, ONE decision for the whole change)

| PR   | Evidence                                                                                                                                                                                                                                                                                                                                                                                           | Estimated lines |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| PR 1 | `PrismaUnitOfWork.test.ts` 4 cases ~85 · 55 doubles across 50 files ~60 · ADR-0023 ~95 · canon paragraph ~15 · 2 fitness comment mirrors ~14 · PR body ~45                                                                                                                                                                                                                                         | **~315**        |
| PR 2 | `CompletePostPublishingUseCase.test.ts` (new, ~14 scenarios + port factories) ~420 · `PostCommandHandlers.complete-publishing.test.ts` (new) ~150 · `.test-helpers.ts` ~15 · PR body ~45                                                                                                                                                                                                           | **~630**        |
| PR 3 | `sagaPublishNowPromotion.test.ts` (new, harness + 6 cases) ~340 · `sagaDeterministicIds.test.ts` rewrite ~140 · `PostCommandHandlers.update.test.ts` rewrite ~50 · `integrationEventDeliveryHandler.test.ts` ~30 · `sagaCrashRecovery.test.ts` ~20 · `sagaCustomerFlow.test.ts` ~35 · `run-tests.sh` ~3 · `create.test.ts` ~2 · saga docs ~20 · `design.md` residuals (W-C, W-E) ~20 · PR body ~50 | **~710**        |
|      | **Total EVIDENCE**                                                                                                                                                                                                                                                                                                                                                                                 | **~1,655**      |

**Declared EVIDENCE band: 1,450–1,800. Hard STOP at 2,000.** If apply's measured evidence would
exceed 2,000, it **stops and reports** rather than deleting assertions — evidence is a pre-approved
budget, not a cap that licenses weakening the proof. Apply reports MEASURED numbers per PR.

**What drives the EVIDENCE number, so the band is judged and not just accepted:** (1) the 50-file
test-double sweep is unavoidable and mechanical (~60 lines); (2) R1–R5 carry 33 scenarios, 8 of them
merge-blocking, and the merge-blocking ones must assert the **persisted row and the outbox** rather
than a double's call log — that is inherently integration-weight; (3) the all-or-nothing proof
(T3.10) needs its own repository built with a failing outbox double.

### Decision requested (Edward — ONE answer covers the whole change)

1. **Confirm the 3-PR chain** (`stacked-to-main`, boundaries and ordering constraint as above), and
2. **Approve the EVIDENCE band 1,450–1,800 with a hard stop at 2,000.**

Apply is blocked on this answer.

---

## Backlog / follow-up rows (named here, NOT done in this change)

| #   | Row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Why deferred                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| B1  | **Migrate the 15 billing throws** (`GatewayBillingService.ts`, `TrialManagementService.ts`) to `executeResultInTransaction` and drop them from fitness #4's exception list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | A3 — Edward signed the deferral; own bounded context, own tests                           |
| B2  | Migrate the remaining ~56 `executeInTransaction` callers whose `let result` capture hides an `err` from the UoW (the D10 class)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Mechanical but wide; each needs its own regression                                        |
| B3  | **D11 class**: sibling Post use cases (`SchedulePostUseCase.ts:187`, `CreatePostUseCase.ts:204`, `UpdatePostUseCase.ts:183`, `DuplicatePostsBatchUseCase.ts:189`) dispatch in-process **inside** the transaction, reaching outbound delivery pre-commit and double-delivering                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Class fix, not this change                                                                |
| B4  | **W1**: `SchedulingPostHandlers.ts:254` / `:354` write `status`/`scheduledAt` directly without bumping `version`; reschedule has **no status guard**, so it can flip a `PUBLISHED` post to `SCHEDULED` outside the FSM                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Pre-existing bypass; not a blocker for this change                                        |
| B5  | **W5**: evicted completed job — `publishWorker.ts:193-196` sets no `removeOnComplete`, adapter default `{count:100}`; `getJobStates` reads a missing job as `failed`, so the wait step fails and the saga FAILs post-pivot with the post still `DRAFT`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Needs retention outliving the poll window, or a reader distinguishing evicted from failed |
| B6  | **W4**: `PostAggregateMapper.toDomain:107-121` silently drops media rows whose `MediaAttachment.create` fails, and `doUpdate:741-746` then deletes them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Should fail closed (`reconstitute`), never drop                                           |
| B7  | **ADR number collision**: `ADR-0020-tenant-context-at-boundaries.md` and `ADR-0020-audit-actor-exclusive-arc.md` both claim 0020                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Discovered while resolving A2; renumbering is its own docs change                         |
| B8  | `UnitOfWork` interface JSDoc (`Repository.ts:164-180`) is Spanish, against CODING_STANDARDS §Comment Quality Rules ("All comments in English")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Touching it inflates PR 1's diff for no behavioural gain                                  |
| B9  | Pre-existing, carried from design: `SchedulePostUseCase.ts:192` counts `incrementPostPublished` at schedule time · `post.update` becomes production-dead after PR 3 (flag, do not delete) · `markAsPublished(providerResults)` naming (N-COR-2) · `PUBLISHING` never durable, edit window open during publish-now (Q4 consequence) · ~~`openspec/config.yaml` cites `#1-#40`, the suite has 41~~ — **CLOSED, and it was never this change's to close**: measured in the verify corrective, the file cites **41** in all three places (`:21`, `:62`, `:86`), fixed upstream on `main` by `8ec9f4a7` ("chore(fitness): add check #41"). The proposal's risk row and the verify report's S2 both predate that commit; nothing was edited here because there is nothing left to edit | Out of contract                                                                           |
