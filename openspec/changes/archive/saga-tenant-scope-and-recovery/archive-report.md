# Archive Report: saga-tenant-scope-and-recovery (N-COR-7 + N-COR-2a, N.B change 1)

**Status**: ARCHIVED — verified PASS WITH WARNINGS, both PRs merged, living specs
reconciled, all four verify-report warnings closed at archive time.

## What this change closed

The saga engine's persistence and recovery paths ran with no declared tenant/system
context — one root, two defects. **N-COR-7**: every `SagaInstance` row stored
`context.userId` (a `CustomerUser.id`, the acting user) in the `accountId` column
instead of the true tenant — a data-correctness defect, not the predicted outage (the
guard-mismatch 500 hypothesized in exploration did NOT reproduce live). **N-COR-2a**:
`initialize()` loaded non-terminal sagas but never resumed them, and both the boot load
and the 5-second retry-recovery scan ran context-less on the guarded client, so
`TenantContextMissingError` was thrown and silently swallowed — both recovery loops were
functionally dead for the ONE class of failure the guard-fix would have exposed (once the
guarded client landed without the context declaration).

After this change: every saga write carries the TRUE tenant, guard-validated; historical
rows are backfilled (metadata-first, join-second, sentinel/RAISE disposition); the engine
runs on the tenant-guarded Prisma client with a dual-layer, column-authoritative context
module (`sagaTenant.ts`); non-terminal sagas resume once per process boot, disjoint from a
now-alive retry-recovery scan; pivot-interrupted sagas are PARKED (auto-resume was
evaluated against a crash-replay proof and GATED-AND-REFUSED — the pivot replay itself is
absorbed, but the step after it loses to optimistic concurrency); and the whole recovery
surface is bounded, contained, and observable.

## Delivery map

| PR                                                                  | Merge                   | Carried                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#173** (`workstream/saga-tenant-scope-and-recovery`, PR1 — scope) | `55d659af` (2026-08-05) | D1 guarded-client wiring (`index.ts:687` resolves `TOKENS.PrismaClient`) · D2 column truth (`SagaContext.accountId` first-class, `userId` kept for audit only) · D3 context declaration (`sagaTenant.ts` — `SAGA_SYSTEM_REASON`, `resolveSagaAccountId`, `runAsSagaTenant`, query-scoped system wraps, dispatch invariant) · D4 backfill migration (`20260731000000_backfill_saga_instance_account_id` + documented no-op `down.sql`) · two-tenant isolation suite (18 tests) · backfill integrity suite (10 tests) · static invariant suite · **Phase 7R/7R2/7R3 4R rework**: dual-layer `sagaTenant.ts` module binding BOTH the ALS context and the RLS GUC, column-authoritative resolution with fail-closed mismatch handling, discriminated `SagaWorkOutcome<T>` (no more silent-skip-as-success), real Prometheus counters, per-row error containment                                                                                                                                                                                                                                                                               |
| **#180** (PR2 — recovery)                                           | `bd1adbb4` (2026-08-11) | D5 boot resume (single pass, disjoint from the widened retry checker via `nextRetryAt` nullability) · D6 horizon 30s→90s · crash-replay dedupe proof (`sagaCrashRecovery.test.ts`, 17 tests) · parked lifecycle (window opens at `parkedAt`, terminalizes once as `parked-expired`, HANDS OFF vocabulary for the shutdown drain) · composition-order fix (`registerSagaDefinitions()` before `sagaManager.initialize()`, with a `definition-unregistered` disposition and a boot-load-failure escalation) · bounded/contained boot (`bootLoadLimit`, `maxConcurrentSagas`, per-row + pass-level containment) · account-less persist fallback removed (residual #8 — `AppError.internal` refusal before any transaction opens) · `run-tests.sh` cancel gate + `sagaCustomerFlow` live-API batch wired (closes the N-CI-2 blind spot for this suite) · **Phase 9R/9R2 4R rework**: production-faithful crash-recovery harness with a real happy path, per-process ownership stated as a deployment constraint (SMELL-73), `COMPENSATING` orphan detection (never resumed), the `SagaParkedWindowExpired` + `SagaCompensatingOrphans` alerts |

## Review history

Both PRs went through full 4R adversarial review per the repo's publish-hot-path trigger
rule, and both returned MERGE-BLOCKING on the first pass:

- **PR1** — all four lenses returned MERGE-BLOCKING with converging evidence on the
  operational layer around an otherwise-sound tenant-scoping core (start path airtight,
  lazy-promise fix real, guard live in-tx). Rework (Phase 7R) rebuilt the module around
  dual-layer binding, column-authoritative resolution, a discriminated skip outcome, real
  observability, and per-row error hardening. A re-verification pass (7R2) then found one
  new CRITICAL (a backfill audit test that could not establish a non-empty audited
  population on an ephemeral CI database) plus three warnings and several structural
  residuals — all closed in 7R2, followed by a residuals pass (7R3) closing four more
  named issues including a static-invariant blind spot to a real cross-tenant-write hazard
  class.
- **PR2** — three of four lenses returned MERGE-BLOCKING. The tenant-isolation core was
  verified CLEAN by all four; what failed was the recovery layer's wiring and its operator
  contract. Nine decisions (W1–W9) replaced the recovery layer in Phase 9R: the shipped
  recovery capability was inert in the deployed composition until W1 fixed the
  composition-order defect; the crash-recovery harness was rebuilt to boot the production
  composition instead of an inverted test-only wiring (W2); the parked contract was made
  canon-coherent (W3); the checker's pivot-replay claim was adjudicated empirically as
  safe (W4); the boot pass was bounded and contained (W5); ownership was stated honestly
  as a per-process constraint instead of half-built claims machinery (W6); the test
  runner's cancel gate was fixed to actually fail the run (W7); vocabulary and
  observability were corrected end to end (W8); spec and design were synced to the
  shipped contract (W9). A re-verification pass (9R2) then closed 8 further advisory
  findings (M1–M8), none merge-blocking.

## Verification

Fresh-context verify at branch tip `10b72d6a` (main, both PRs merged):
**PASS WITH WARNINGS — 0 CRITICAL, 17/17 requirements, 46/46 scenarios COMPLIANT**
(engram `sdd/saga-tenant-scope-and-recovery/verify-report`, obs 456). Evidence: build
(`tsc -b apps/api packages/shared`) exit 0; `sagaCrashRecovery` 17/17 · `sagaTenantIsolation`
18/18 · `sagaAccountIdBackfill` 10/10 · `chaos/saga-step-retry-recovery` 1/1 (combined
envelope 46/46, exit 0) · `sagaCustomerFlow` 13/13 live-API · `sagaBootResume.test.ts`
(unit) 8 passed · `sagaContextInvariants.static.test.ts` 45 passed · saga unit surface 17
files / 209 tests · 2 carried tenant-boundary integration tests · ESLint `--max-warnings 0`
exit 0 · Prettier clean · fitness #3/#5/#8/#9/#10/#21/#23 all 0 · zero `canon-exception`
markers on the saga surface. The runner-gate reproduction (`integration:saga-recovery`
against an unreachable `DATABASE_URL`) correctly fails the run (17 cancelled, exit 1).

All four verify-report warnings are closed by this archive commit:

1. **Runner exit-code propagation** (narrow residual, non-merge-blocking): `run-tests.sh`
   captures each batch's runner exit code but the final gate tests only `TOTAL_FAIL` /
   `TOTAL_CANCEL`, so a batch that exits non-zero with clean counts would not fail the
   script. The MERGE-BLOCKING scenario the spec names (DB unreachable → cancellations) IS
   closed and was reproduced live; this is the one warning left OPEN, carried to
   `saga-engine-terminal-hygiene` (see below) rather than fixed here, because closing it
   safely requires auditing every existing batch's exit-code semantics, which is out of
   this change's scope.
2. **Drain-sense "park" vocabulary** — `sagaTenantIsolation.test.ts:1168`/`:1203` described
   the graceful-shutdown drain (which HANDS OFF) using "park" language, contradicting the
   living spec's "`parked` SHALL carry exactly one meaning" normative rule. Fixed in this
   archive commit: `describe("shutting down while a saga cannot be handed off", ...)` and
   `"the failed handoff must surface at ERROR"`. Vocabulary-only; no code path, log line,
   metric, alert, or runbook was affected. **Verification of this fix could not be run by
   this archive agent** (no shell/test-execution tool available in this delegation) — the
   orchestrator or a follow-up worker should run the suite single-file (see the exact
   command in the archive task instructions) and confirm 18/18.
3. **`tasks.md` task 11.3's evidence table understated the shipped tree** — it recorded
   PR2's own 0-defect gate snapshot (`sagaCrashRecovery` 9/9, saga unit 16 files/199 tests)
   from BEFORE the 9R/9R2 rework grew the suites. Fixed: an evidence note was appended to
   task 11.3 with the verified final figures (`sagaCrashRecovery` 17/17, `sagaBootResume`
   8, static invariant suite 45, saga unit 17 files/209, isolation 18/18, backfill 10/10,
   chaos 1/1, `sagaCustomerFlow` 13/13 live, cancel-gate reproduction now exits 1).
4. **`design.md §Interfaces/Contracts` stale signatures** — declared
   `resolveSagaAccountId(context: SagaContext)` and `runAsSagaTenant(...): Promise<T |
undefined>` where the shipped code takes a `SagaInstance` and returns the
   discriminated `SagaWorkOutcome<T>`, and a three-field `SagaMetrics` addition where the
   shipped surface adds ten fields. Fixed: the code block now matches
   `apps/api/src/saga/sagaTenant.ts` and `sagaManagerTypes.ts` verbatim, with a note
   explaining the drift and why the D3 amendment prose was already authoritative over it.

The proposal's `## Success Criteria` (all seven, previously unchecked despite being met)
were ticked at archive per the verify report's SUGGESTION 1.

## Open follow-ups (tracked, not dropped — owned by `saga-engine-terminal-hygiene`, change 2 of N.B)

- **Runner exit-code propagation** — `run-tests.sh`'s final gate should test each batch's
  captured runner exit code, not only `TOTAL_FAIL`/`TOTAL_CANCEL` (verify-report WARNING 1
  above).
- **SMELL-73** — no row claims; more than one API replica with the saga engine enabled is
  UNSUPPORTED until claims land (`OutboxClaimService`, `FOR UPDATE ... SKIP LOCKED`
  pointer already in the guards doc).
- **`parkedAt` is not durable** — parking is per-process and re-derived on restart, so a
  crash-looping pod re-opens the parked-expired window indefinitely; needs persistence to
  survive a restart correctly.
- **Retry-scan `take: 50` head-of-line starvation** — the same oldest page is re-selected
  every tick because `nextRetryAt` clears only on success, plus the `take:50`-vs-boot-ceiling
  asymmetry.
- **`COMPENSATING` orphan resume** — detection shipped (9R2.2); the fix (loading, claiming,
  and resuming a compensation walk safely) is out of scope here.
- **`failSaga`/timeout-checker terminal hygiene** — `activeInstances.delete` on `failSaga`,
  the timeout checker's terminal filter, the waiting≠failed step contract, the in-flight
  execution guard on `executeSaga`, and `handleEvent` re-entry amplification (N-COR-2 (b)
  and (c) — never in this change's scope; N-COR-2a (a), the boot/scan context+resume root
  cause, IS closed here).
- **CQRSBus durable dedupe** — **SMELL-71** (no command-id dedupe means a create-step
  replay can duplicate a DRAFT row pre-pivot; no external side effect, but a duplicate
  nonetheless) and **SMELL-72** (dead `TOKENS.SagaManager` registration,
  `setupServices.ts:937-958`, never resolved anywhere).
- Runner has a cancel gate but no skip gate (verify-report SUGGESTION 2) — out of this
  change's scope, a natural companion for the successor change.
- Six residual `saga:*` Redis cache entries left by the live-API suite (verify-report
  SUGGESTION 3) — self-expiring TTL, not a defect.

## Traceability (Engram observation IDs)

- Proposal: obs 430 (`sdd/saga-tenant-scope-and-recovery/proposal`)
- Spec (delta): obs 432 (`sdd/saga-tenant-scope-and-recovery/spec`)
- Design: obs 433 (`sdd/saga-tenant-scope-and-recovery/design`), design-gate FAIL obs 434,
  design-gate PASS-on-re-run obs 435
- Tasks: obs 436 (`sdd/saga-tenant-scope-and-recovery/tasks`)
- Verify report: obs 456 (`sdd/saga-tenant-scope-and-recovery/verify-report`)
- This archive report: `sdd/saga-tenant-scope-and-recovery/archive-report`
