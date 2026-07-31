# Proposal: Saga Tenant Scope and Recovery (N-COR-7 + N-COR-2a)

## Intent

Change 1 of the N.B core-publishing correctness workstream. The saga engine's persistence and recovery paths run without any declared tenant/system context — one root, two defects:

- **N-COR-7 — data corruption, NOT outage** (empirically corrected 2026-07-31): every `SagaInstance` row stores `context.userId` (a `CustomerUser.id`) in the `accountId` column (`SagaManagerExecution.ts:523,537`). Live run of `sagaCustomerFlow.test.ts` against API+DB: 12/13 pass, zero mismatch errors — the exploration's "500 at the door" prediction did not reproduce. Sagas persist fine with the WRONG tenant value; `@@index([accountId, status])` and any future tenant-scoped saga query key on garbage.
- **N-COR-2a — in-flight sagas die on deploy**: `initialize()` loads PENDING/RUNNING but never resumes them (`SagaManagerLifecycle.ts:312-341`), and both the boot load and the 5s retry-recovery scan run context-less on the guarded client → `TenantContextMissingError` swallowed (:338, :404) → both loops are DEAD. Verified live consequence: the 1 failing test — a post-pivot failure never reaches FAILED because persisted retries (`nextRetryAt`, Execution:180-197) are only ever resumed by the dead checker → saga stuck RUNNING past 30s (canon terminal-state violation).

## Verified surface facts (source-checked this phase)

| Fact                                                                                                                                                                          | Evidence                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `context.userId = customer.id` (payload.sub); `metadata.accountId = customer.accountId` — the CORRECT value already travels in context                                        | `SagaIntegration.ts:436-443`; `customerAuthMiddleware.ts:59-70`                    |
| Engine writes `accountId: context.userId` on both upsert branches                                                                                                             | `SagaManagerExecution.ts:523,537`                                                  |
| `sagaInstance` IS guard-enrolled; mismatch logic exists and should have thrown                                                                                                | `tenantGuard.ts:132,208-240,282-295`                                               |
| Engine resolves the GUARDED client; first persist is AWAITED in-request                                                                                                       | `setup.ts:61-64`; `setupServices.ts:948`; `Lifecycle:127`                          |
| **⇒ only consistent mechanism: guard's query extension does not intercept writes inside `$transaction(async (tx) => …)` at runtime** — candidate layer-1 bypass BEYOND sagas  | deduction from the above + live non-reproduction; empirical pin required in design |
| Zero `withSystemContext` anywhere in `apps/api/src/saga/**`                                                                                                                   | grep = 0 matches                                                                   |
| Timeout checker iterates in-memory `activeInstances` only → restart empties it → orphaned rows invisible even to timeout                                                      | `Lifecycle:412-431`                                                                |
| Sole production start path = customer route; backfill join EXISTS: stored value = `CustomerUser.id` → `CustomerUser.accountId`; secondary source `context.metadata.accountId` | grep `startSaga(`; `schema.prisma:335-337`                                         |
| `SagaInstance.accountId` is `String?`, no FK                                                                                                                                  | `schema.prisma:2058`                                                               |
| `sagaCustomerFlow.test.ts` absent from `run-tests.sh` (N-CI-2 blind spot)                                                                                                     | grep saga in run-tests.sh = 0                                                      |

## Scope

### In Scope

- **Tenant scope (N-COR-7)**: `accountId` first-class in `SagaContext` (`packages/shared/src/saga.ts`), populated from `customer.accountId` in `SagaIntegration`; engine persists `context.accountId` — never `userId` — into the column.
- **Backfill migration**: rows whose `accountId` matches a `CustomerUser.id` → set that user's `accountId` (prefer `context->metadata->>accountId` when present — it is the authoritative source). Unmappable rows get an explicit disposition (see question round; recommended default: terminal rows → NULL + count reported; non-terminal unmappable rows → RAISE, they should not exist).
- **Context declaration (N-COR-2a root)**: engine-internal persistence and background loops (`loadActiveSagas`, retry-recovery checker, timeout-checker persistence, background `persistSagaInstance`) run under `withSystemContext()` — the canon-sanctioned path — instead of depending on the accidental `$transaction` bypass. Context errors are no longer swallowed silently (log + metric).
- **Boot resume (N-COR-2a)**: `initialize()` resumes PENDING/RUNNING sagas WITHOUT `nextRetryAt` via `executeSagaAsync`; rows WITH `nextRetryAt` stay owned by the (now-alive) retry checker. Safety properties the design must uphold: terminal sagas never re-execute (existing guard), no compensation at/past the pivot, no double side-effects on pivot re-execution (leans on canon deterministic dedupeKey — design verifies).
- **CI wiring**: add `sagaCustomerFlow.test.ts` to `run-tests.sh` (closes this file's N-CI-2 slice). Expected: this change flips the 13th test green.
- **Tests**: two-tenant saga isolation proof (list/get scoped by TRUE accountId); boot-resume integration proof (kill mid-saga → restart → terminal state); backfill test; unit tests for context declaration + column write.

### Out of Scope

- `failSaga`/timeout terminal hygiene (`activeInstances.delete`, terminal filter), waiting≠failed step contract, in-flight execution guard, `handleEvent` re-entry amplification → **change 2** (`saga-engine-terminal-hygiene`). Ownership of the live stuck-non-terminal failure: its ROOT CAUSE (dead recovery scan) is THIS change — verified in code (Execution:180-197 retries resume only via the checker); correct wait-step semantics so multi-channel publishes stop burning retries remain change 2.
- Post status transition (change 3), client publishing (change 4), N-COR-4/5/6.
- Generalized `$transaction` guard-bypass remediation beyond the saga engine — escalated as a finding; becomes its own security backlog item if design confirms it is general. Never silently dropped.

## Capabilities

### New Capabilities

- `saga-crash-recovery`: in-flight sagas survive deploy/restart — boot resume, retry-recovery scan, and the declared-context contract for engine-internal persistence.

### Modified Capabilities

- `multi-tenant-isolation`: `SagaInstance.accountId` requirement — column carries the true tenant, populated on create, backfill integrity (zero `CustomerUser.id` values post-migration).
- `tenant-context-boundaries`: saga engine internals become a declared system-context boundary (today: undeclared + errors swallowed); route-facing saga reads stay tenant-scoped — system context must NOT leak into customer-visible queries.

## Approach

Thread the truth, declare the context, then resume — in that order. The correct tenant value already exists in `context.metadata.accountId`; the change promotes it to a typed field, uses it for the column, and repairs history via a reliable `CustomerUser` join. Recovery then becomes possible: with system context declared, the boot load and retry scan actually run, and `initialize()` gains the resume step the canon's recovery rules require. Design's load-bearing decision is the **$transaction bypass pin** (empirical, FIRST): it determines whether post-fix engine writes are guard-intercepted (and how where-injection behaves under system context), and whether the bypass generalizes beyond sagas.

## Affected Areas

| Area                                                      | Impact   | Description                                                          |
| --------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `packages/shared/src/saga.ts`                             | Modified | `SagaContext.accountId` first-class + `createSagaContext`            |
| `apps/api/src/saga/SagaIntegration.ts`                    | Modified | populate `accountId` from customer, not only metadata                |
| `apps/api/src/saga/SagaManagerExecution.ts`               | Modified | column write from `context.accountId`; system-context persistence    |
| `apps/api/src/saga/SagaManagerLifecycle.ts`               | Modified | boot resume; system context on loops; stop swallowing context errors |
| `infra/prisma/schema.prisma` + backfill migration (+down) | Mod/New  | backfill userId→accountId — SENSITIVE                                |
| `apps/api/scripts/run-tests.sh`                           | Modified | wire `sagaCustomerFlow.test.ts`                                      |
| `apps/api/tests/{unit,integration}/**`                    | New/Mod  | two-tenant proof, kill-restart proof, backfill test                  |

## Risks

| Risk                                                                                                     | Likelihood | Mitigation                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TOP — $transaction bypass hypothesis wrong** (some other mechanism explains the live non-reproduction) | Medium     | design pins it empirically FIRST; the fix (declared system context + correct value) is safe under EITHER outcome                                    |
| Bypass confirmed general → layer 1 absent for every itx write on guarded models                          | Medium     | escalate as standalone security finding; RLS layer 2 posture re-checked (dev postgres BYPASSRLS is known-inert)                                     |
| Backfill ambiguity: rows mapping via neither join nor metadata                                           | Low-Med    | explicit disposition + success criterion "zero `CustomerUser.id` values remain"                                                                     |
| Boot resume double-execution (crash between step execute and persist re-runs the pivot)                  | Medium     | resume only non-terminal rows; canon deterministic dedupeKey dedupes the re-issued command — design VERIFIES this end-to-end before enabling resume |
| Resume interacts with change 2's missing in-flight guard (checker + handleEvent concurrency)             | Medium     | sequencing note: change 2 follows immediately; resume scope kept minimal (boot-time, single pass)                                                   |
| Publish hot path                                                                                         | Certain    | full 4R review tier per repo trigger rules                                                                                                          |
| CI wiring surfaces latent failures                                                                       | Expected   | the 13th test SHOULD flip green here; if not, blocking finding, not a skip                                                                          |

## Rollback Plan

Revert branch pre-merge (no merge until green). Post-merge: code changes revert cleanly and independently per PR; the backfill migration's down.sql is a documented no-op-by-design — restoring corrupted userId values is not a rollback goal, and post-backfill values are valid accountIds that remain correct even if the code reverts. CI wiring reverts by removing one line from `run-tests.sh`.

## Dependencies

- Branch `workstream/saga-tenant-scope-and-recovery` off main.
- `omnipost-allow sensitive-edit` token at APPLY (`infra/prisma/**`); `pnpm db:up` for migration + integration tests.
- Delivery: forecast ~400-500 LOC + migration → **chained PRs anticipated** (PR1 = tenant scope + backfill + two-tenant test; PR2 = recovery + kill-restart test + CI wiring). FINAL decision at tasks via the Review Workload Guard.
- Sequencing: MUST land before the N-SEC-3 tail item `api-guarded-client-injection`; change 2 (`saga-engine-terminal-hygiene`) builds on this change's context declaration.

## Success Criteria

- [ ] `SagaContext` carries `accountId` first-class; every new saga row stores `customer.accountId` in the column.
- [ ] Zero rows with a `CustomerUser.id` in `accountId` post-backfill; unmappable rows dispositioned per the agreed rule, count reported.
- [ ] Two-tenant isolation proof green: cross-tenant saga get/list denied; scoping keys on the true tenant.
- [ ] Boot-resume proof green: kill mid-saga → restart → saga reaches a terminal state; boot load + retry checker demonstrably alive (no swallowed context errors; error path logs + metrics).
- [ ] The live 13th test (post-pivot terminal) green and `sagaCustomerFlow.test.ts` wired into `run-tests.sh`.
- [ ] $transaction bypass question answered empirically and recorded (escalated if general).
- [ ] 0-defect gate: lint 0/0, tsc 0, fitness greps green, CI green.

## Proposal question round (assumptions needing user review)

Interactive question round could not be run from this executor context; these are the product decisions the proposal currently ASSUMES — correct any of them and the proposal updates:

1. **Unmappable backfill rows**: assumed disposition — terminal-state rows set `accountId = NULL` + reported count; non-terminal unmappable rows abort the migration (RAISE). Alternative: delete terminal debris outright. Which?
2. **Resume posture at the pivot**: assumed auto-forward-resume for ALL non-terminal sagas (canon: steps are idempotent, dedupeKey dedupes re-issued commands). Alternative: park pivot-interrupted sagas for manual review if dedupe verification is inconclusive. Acceptable to gate this on design's dedupe verification?
3. **Customer visibility**: resumed sagas that end FAILED (retries exhausted while the process was down) stay visible via existing saga status endpoints only — no new notification in this change. OK to defer messaging to change 4 (client UX)?
4. **$transaction bypass escalation**: if design confirms the bypass is general (all itx writes skip layer 1), assumed handling is a standalone HIGH security backlog item — NOT scope creep into this change. Confirm?
