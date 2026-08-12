# Proposal: Saga Engine Terminal Hygiene (N-COR-2c + compensation integrity + SMELL-73)

## Intent

Change 2 of the N.B core-publishing correctness workstream, successor of the archived `saga-tenant-scope-and-recovery` (main = 63c10f07). Terminal-lifecycle and ownership hygiene of the saga engine: the engine must **tell the truth about compensation**, **never lose a customer publish to retry-budget amplification**, and **own every non-terminal row it inherits**. The exploration's factual map is file:line-verified at main; its slicing was approved by Edward verbatim — this proposal formalizes it, it does not re-litigate it.

## Problem statement (verified at main 63c10f07)

| Defect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Evidence                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Headline — automatic compensation never persists `COMPENSATING`.** The auto walk goes `RUNNING → COMPENSATED` (`SagaManagerExecution.ts:253-263`, `:378`); only the manual admin endpoint writes the status (`SagaManagerLifecycle.ts:734`). A crash mid-auto-compensation leaves a `RUNNING` row; boot classifies it `resumed` and **re-executes the failed step FORWARD over partially-undone state**. The `compensatingOrphans` gauge only ever sees admin-endpoint rows; the operator cannot re-drive (endpoint requires `FAILED`, `:730-732`). Per-step walk progress is memory-only (`:361`, `:371`; single persist at `:398`). | Exploration item 4        |
| **Customer-facing — waiting ≠ failed (N-COR-2c).** `SagaStepResult` is a boolean (`packages/shared/src/saga.ts:34-39`); the wait step's "still pending" is indistinguishable from failure. `handleEvent` (`SagaManagerLifecycle.ts:794-810`) re-dispatches per worker event, no coalescing, no in-flight guard. Wait budget is 35 s total (5/10/20 s); **an N-channel publish burns up to N-1 retries on sibling completion events alone — a 4-channel publish can reach FAILED with all four channels published.**                                                                                                                     | Exploration item 5 + 9(c) |
| **Ownership — no row claims (SMELL-73).** Boot load (`:958-969`) and retry scan (`:1027-1046`) are plain `findMany` + detached dispatch; the scan's hard-coded `take: 50` re-selects its slow head every 5 s tick while rows 51+ starve. `bootLoadLimit` is documented operator config but **wired nowhere in production** (`SagaIntegrationConfig` has no field).                                                                                                                                                                                                                                                                      | Exploration items 1, 3    |
| **Parked window is in-memory only** (`parkedAt` Map, `:151`); a restart erases the operator window a parked pivot-interrupted saga depends on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Exploration item 2        |
| **Test gate dishonest.** `run-tests.sh` final gate reads only fail/cancel totals (`:279`); a batch whose runner exits non-zero with 0 fails prints `[FAIL]` and the script still exits 0. Dead `TOKENS.SagaManager` registration (`setupServices.ts:937`, `types.ts:188`) resolves nowhere; on accidental resolve it boots a second engine.                                                                                                                                                                                                                                                                                             | Exploration items 7, 8    |

## Scope

### In Scope (approved slices, approved order)

- **Slice 0 — gate honesty (micro-PR, lands first):** aggregate the captured runner exit code into `run-tests.sh`'s final gate; delete the dead `TOKENS.SagaManager` registration + token; correct `docs/product/MASTER_PLAN_ES.md:159` (N-COR-2(b) is closed at main — doc drift). Every later "tests pass" claim depends on this slice.
- **Slice 1 — durable, honest compensation state (REBUILD of the walk, not a patch):** persist `COMPENSATING` before dispatching the automatic walk; durable per-step compensation progress; `COMPENSATING` in the boot predicate with its own disposition (resume the walk in the compensation direction, never forward); admin endpoint re-drives a `COMPENSATING` row; `compensatingOrphans` finally measures the production path. Prerequisite for any claim work — today there is nothing to claim.
- **Slice 2 — waiting ≠ failed (N-COR-2c):** REBUILD `SagaStepResult` as a discriminated union (succeeded / failed / waiting — three domain states, not a boolean); `waiting` consumes no retry budget; de-amplify `handleEvent` (an N-channel publish must not burn N-1 retries on completion events); in-process in-flight execution guard (matches the documented single-replica deployment).
- **Slice 3 — row claims for recovery dispatch (SMELL-73):** additive nullable `claimedAt`/`claimedBy` columns; claim at **selection time in BOTH readers** (boot load + retry scan) using the `OutboxClaimService` SQL shape wrapped in the saga's own system boundary (`SagaInstance` is guard- and RLS-enrolled; `OutboxEvent` is global — the pattern is copied, not the code); scan starvation closed; `bootLoadLimit` + retry-scan page size wired through `SagaIntegrationConfig`; fitness #23 exception with its coordinated three-part edit (CLAUDE.md catalog + fitness.yml mirror + ADR). **DOWNGRADES the multi-replica constraint to "at-least-once, pending SMELL-71" — does not lift it.**
- **Slice 4 — durable parked window:** separate `SagaParkedWindow` table keyed by `sagaId` (option C — durable AND preserves the saga row's byte-identity promise, which was about the row, not about "nothing anywhere records the decision").

### Out of Scope (non-goals, explicit)

- **CQRSBus command-id dedupe (SMELL-71)** — its OWN future change: forces a canon amend-or-implement decision, and the bus carries independent defects (`redis.keys()` blocking hazard, metrics gating, error flattening) that a dedupe PR would drag in. The `keys()` hazard goes to the backlog now.
- **Lifting the multi-replica constraint.** Lease-based claims give at-least-once, exactly as the outbox does; declaring multi-replica supported requires the bus dedupe or a per-step idempotency proof.
- **SMELL-70 nullability flip.** Claim columns stay additive/nullable; the `accountId` nullability conversation stays a separate, sentinel-row-gated decision. Do not bundle.

## Capabilities

### New Capabilities

- `saga-compensation-integrity`: durable, honest compensation lifecycle — status persisted before the walk, per-step durable progress, boot disposition, admin re-drive, honest orphan gauge.
- `saga-step-outcome-contract`: three-state step result, waiting semantics for the publish wait step, event de-amplification, in-flight execution guard.

### Modified Capabilities

- `saga-crash-recovery`: (a) "COMPENSATING orphans are counted, never resumed" becomes a resume-the-walk disposition; (b) "recovery ownership partitioned PER PROCESS" becomes row claims at selection time, reporting downgraded to at-least-once-pending-SMELL-71; (c) bounded-boot requirement gains a production-wired `bootLoadLimit` + scan page config; (d) parked requirement gains the durable `SagaParkedWindow` record; (e) the test-runner requirement gains final-gate runner-exit aggregation.

## Approach

Make the truth durable first, then hand out ownership of it. Slice 0 makes the proof surface honest; slice 1 makes compensation state durable and honest (creating the thing claims will claim); slice 2 fixes the highest customer-impact bug independently of any schema work; slices 3-4 then add the schema-backed ownership and park records under one architectural conversation (ADR). Hard orderings from the evidence: slice 1 strictly before slice 3's COMPENSATING resume (the carry-list's stated order is inverted — durable status is the prerequisite, not the dependent); slice 2 is independent of claims (do not gate the customer bug behind a token-gated migration).

## Affected Areas

| Area                                                                   | Impact   | Description                                                                                                                     |
| ---------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/saga/SagaManagerExecution.ts`                            | Modified | compensation walk REBUILD; step-outcome handling; `runSagaSteps` countermeasure control-flow straightened                       |
| `apps/api/src/saga/SagaManagerLifecycle.ts`                            | Modified | boot predicate/disposition, `handleEvent` de-amplification, admin re-drive, claim-aware readers, page config                    |
| `packages/shared/src/saga.ts`                                          | Modified | `SagaStepResult` discriminated union REBUILD                                                                                    |
| `apps/api/src/saga/SagaIntegration.ts`                                 | Modified | `bootLoadLimit` + page-size config surface (config exists but is unwired today)                                                 |
| `apps/api/src/saga/` claim service (new)                               | New      | `OutboxClaimService` SQL shape inside `withSagaSystemRead`/`runSagaSystemTransaction` (extend `sagaTenant.ts`, do not touch it) |
| `infra/prisma/schema.prisma` + migrations                              | Mod/New  | additive nullable claim columns + `SagaParkedWindow` — **SENSITIVE**                                                            |
| `apps/api/scripts/run-tests.sh`                                        | Modified | final-gate runner-exit aggregation                                                                                              |
| `apps/api/src/infrastructure/container/{setupServices,types}.ts`       | Modified | delete dead registration + token                                                                                                |
| `CLAUDE.md` + `.github/workflows/fitness.yml` + `docs/technical/ADR-*` | Mod/New  | fitness #23 exception (three-part edit) + two ADRs                                                                              |
| `docs/product/MASTER_PLAN_ES.md`                                       | Modified | N-COR-2(b) drift correction                                                                                                     |
| `apps/api/tests/**`                                                    | New/Mod  | crash-mid-compensation proof, amplification proof, claim contention, parked-window restart survival                             |

## Risks

| Risk                                                                                                                                                                                                                                           | Likelihood | Mitigation                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| Slice 2 flips the parking evidence test's terminal-`FAILED` assertion for a **different reason** than its revisit comment anticipates (`SagaManagerLifecycle.ts:441-446` documents `FAILED → COMPLETED` as the drop-the-parking-branch signal) | High       | resolve explicitly in DESIGN, not discovered in CI                                                      |
| Slice 1 changes what `compensatingOrphans` measures — thresholds tuned on today's near-zero gauge start firing on the real number                                                                                                              | Certain    | alert rules move within slice 1's PR                                                                    |
| The two empirical probes the explorer could not run (N-channel amplification arithmetic; crash-mid-compensation forward-resume)                                                                                                                | —          | become DESIGN-phase probes via the existing chaos + boot-resume harnesses before spec assertions freeze |
| Fitness #23 goes non-zero the moment claim SQL lands                                                                                                                                                                                           | Certain    | coordinated three-part edit + ADR in the same PR, else CI red                                           |
| SMELL-70 collision on `SagaInstance` columns                                                                                                                                                                                                   | Medium     | claim columns additive/nullable; nullability flip stays out of scope                                    |
| Publish hot path                                                                                                                                                                                                                               | Certain    | full 4R review tier per repo trigger rules                                                              |

## Rollback Plan

Chained PRs to main revert independently. Slices 0-2 are code-only — clean reverts. Slices 3-4 migrations are additive (nullable columns, new table): down migrations drop them with no customer-data loss; claim/park metadata is operational state the pre-change code simply ignores, so a code revert without a schema revert is also safe.

## Dependencies & Delivery

- Branch `workstream/saga-engine-terminal-hygiene` off main 63c10f07.
- **Sensitive-path forecast:** slices 0-2 need NO token. Slices 3-4 need `omnipost-allow sensitive-edit` (`infra/prisma/**` schema + migration) and `pnpm db:up` before migrating.
- **ADR candidates:** (1) _Saga recovery row ownership + durable park record_ — claims, lease-vs-timeout-horizon, fitness #23 exception, `SagaParkedWindow`, one conversation not four; (2) _Where command idempotency lives_ — forced by the canon-vs-code divergence (canon says the bus dedupes by command id; `CQRSBus.ts:91-132` never reads it), resolved in the future CQRSBus change but the question is named here.
- **Delivery:** chained PRs **stacked-to-main** (cached strategy). Slice 0 = micro-PR; slices 1 and 2 likely one PR each; slices 3/4 may share the schema PR if the ADR lands together. Review Workload Forecast — Decision needed before apply: **Yes** (resolved: chained); Chained PRs recommended: **Yes**; 400-line budget risk: **High**.
- Successor context: the future CQRSBus dedupe change is the gate for ever lifting the multi-replica constraint.

## Success Criteria

- [ ] A crash mid-automatic-compensation leaves a `COMPENSATING` row; boot resumes the WALK (never forward); the admin endpoint re-drives it; `compensatingOrphans` measures the production path.
- [ ] Per-step compensation progress is durable; a resumed walk has an engine-side record and does not rely on `compensate()` idempotency alone.
- [ ] An N-channel publish cannot reach `FAILED` from sibling completion events; `waiting` is a distinct outcome consuming no retry budget; only one execution advances a saga at a time in-process.
- [ ] Both recovery readers claim rows at selection time; scan starvation closed; ownership reporting reads "at-least-once, pending SMELL-71" — not multi-replica supported.
- [ ] `bootLoadLimit` and the retry-scan page size are settable in production via `SagaIntegrationConfig`.
- [ ] The parked operator window survives restart via `SagaParkedWindow`; the parked saga row stays byte-identical.
- [ ] `run-tests.sh` exits non-zero when any batch runner exits non-zero; dead `TOKENS.SagaManager` registration + token deleted; `MASTER_PLAN_ES.md` N-COR-2(b) corrected.
- [ ] Fitness #23 exception landed as a coordinated three-part edit; both ADRs recorded.
- [ ] 0-defect gate: lint 0/0, tsc 0, fitness greps green, CI green.

## Proposal question round (assumptions needing user review)

Edward approved the exploration's slicing verbatim; no scope question remains. Three product assumptions the proposal makes inside that scope — correct any and the proposal updates:

1. **Admin re-drive semantics (slice 1):** assumed `compensateSaga` accepts `COMPENSATING` in addition to `FAILED` and RESUMES the walk from durable progress (never restarts it from step 0). OK?
2. **Customer visibility of slice 2's outcome change:** publishes that FAIL today will COMPLETE after slice 2 — assumed no new customer notification; existing saga status endpoints only, messaging deferred to the client-UX change. OK?
3. **Alert ownership (slice 1):** assumed the `compensatingOrphans` alert-threshold update ships inside slice 1's PR (code and alert move together), not as a separate ops task. OK?
