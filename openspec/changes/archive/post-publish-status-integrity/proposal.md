# Proposal: post-publish-status-integrity (N-COR-1)

**Inputs**: `explore.md` (defect confirmed at `main 31e2a2ad`), `pre-propose-decisions.md` (Q1–Q5 signed; honoured verbatim).

## Intent

A publish-now saga reaches `COMPLETED` while `Post.status` stays `DRAFT` and `publishedAt` stays `null`. `UpdatePostStatusStep` (`packages/shared/src/saga.ts:865-946`) routes the terminal transition through the content-only `post.update` command, whose handler drops `status`/`publishedAt` (`apps/api/src/cqrs/handlers/PostCommandHandlers.ts:220-234`). The provider has the post, the database denies it, and both re-publish guards (`SagaIntegration.ts:428`, `PostCommandHandlers.ts:362`) key off a status that never advances — a silent double-publish path. The aggregate's `startPublishing()` / `markAsPublished()` are correct and dead (zero production callers).

## Scope

### In scope

- New mutating use case in `packages/core/posts/`: load aggregate → `startPublishing()` → `markAsPublished(outcome)` → save, in ONE Unit of Work, honouring `expectedVersion` (OCC). (Q1, Q4)
- New command type + Zod schema (`packages/shared/src/cqrs.ts`), CQRS handler, DI token + registration.
- `UpdatePostStatusStep` becomes an outcome-forwarder emitting the new command; it no longer chooses a target status (its `FAILED` computation is unreachable — explore §6.4).
- The command payload carries the publish outcome (which channels succeeded) — the N-COR-2 seam. A non-total outcome is refused with an error `Result`; never a silent success.
- Idempotent re-application: a retry that finds the post already `PUBLISHED` succeeds without a second event (retryable-step contract).
- Close the class: remove `status` from `UpdatePostCommandSchema` and the warn-and-drop branch. The saga step is the sole producer (verified), so the mis-route becomes a compile error.
- Rewrite the lock-in tests (`apps/api/tests/unit/PostCommandHandlers.update.test.ts`, `sagaDeterministicIds.test.ts`); add the integration test (`PUBLISHED`, `publishedAt` set, `PostPublished` outbox row, second `/start` rejected), listed in `scripts/run-tests.sh`.

### Out of scope (non-goals)

- Partial-failure policy and status — N-COR-2, its own ADR + product decision (Q5). `markAsFailed()` stays unwired until then.
- Schema migration (Q2); backfill / reconciliation (Q3); FSM amendment or `DRAFT → PUBLISHED` direct hop (Q4).
- `mediaIds` drop, phantom `version: 2`, `PublishPostCommandHandler` naming → backlog SMELL rows.

## Capabilities

### New Capabilities

- `post-publish-status-promotion`: the terminal status transition after a total-success publish-now — two-hop through the aggregate, one UoW, outbox in-transaction, fail-closed on non-total outcomes, re-publish guards effective.

### Modified Capabilities

- None (`saga-step-outcome-contract` is unchanged: the step still returns `succeeded`/`failed`).

## Approach

Aggregate-driven, per ARCHITECTURE_CANON §CQRS/Commands, §CQRS Bus, §Saga/Outbox coupling. The step stays a thin emitter (deterministic `cmd-{sagaId}-{stepId}`); the handler delegates; the use case is the single writer. `PostPublished` (and `PostPublishingStarted`, a Q4 consequence) reach the outbox in the same transaction as an effect. The async event-projection alternative is rejected (parallel write path).

## Affected Areas

| Area                                                                       | Impact       | Description                                                        |
| -------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------ |
| `packages/core/posts/src/<Promotion>UseCase.ts`, `index.ts`                | New          | Two-hop promotion, UoW, OCC, idempotent                            |
| `packages/shared/src/cqrs.ts`                                              | Modified     | New command + schema; drop `status` from `UpdatePostCommandSchema` |
| `packages/shared/src/saga.ts` (`UpdatePostStatusStep`, `ScheduleStepData`) | Modified     | Emit new command; record scheduled channel ids for the outcome     |
| `apps/api/src/cqrs/handlers/PostCommandHandlers.ts`                        | Modified     | New handler in `createPostCommandHandlers`; remove drop branch     |
| `apps/api/src/infrastructure/container/{types,setupPostUseCases}.ts`       | Modified     | Token + registration                                               |
| `apps/api/tests/unit/`, `tests/integration/`, `scripts/run-tests.sh`       | Modified/New | Lock-in rewrite; DoD integration test                              |

## Fitness functions

#2/#3/#4 (core purity), #6 (handler no Prisma), #7 (deterministic command id), #8/#9/#10 (headers/layers), #21/#22 (use case in core, wired only in the root), #30 (new suite must be listed), #32, #38 (post read via the repository port only), #40 (UoW is the seam — no own `$transaction`).

## Risks

| Risk                                                                                                                | Likelihood | Mitigation                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Outcome not observable: `ScheduleStepData` records `jobIds` + `channelCount` only; the status reader returns counts | High       | Design: record `channelIds` at schedule; total-success outcome = every scheduled channel `success: true`. `externalId` enrichment is N-COR-2 |
| Tenant context: the step runs from the engine, not a request                                                        | Med        | Design routes the UoW through the saga tenant primitives (`sagaTenant.ts`) so the RLS GUC is bound                                           |
| OCC gap on reused drafts: `skippedCreation` records no `version` (`saga.ts:520-525`)                                | Med        | Design decides (read version at reuse or repository guard); spec states the behaviour                                                        |
| Two-hop bumps version twice                                                                                         | Med        | Load-once/save-once; design reconciles the token (Q4)                                                                                        |
| `openspec/config.yaml` cites `#1-#40`; the suite has 41                                                             | Low        | Report-only docs fix                                                                                                                         |

## Rollback Plan

Code-only, no migration: revert the PR range. The saga returns to the prior routing with no data-shape change; rows promoted meanwhile remain valid `PUBLISHED` rows.

## Dependencies

- Signed decisions Q1–Q5 (`pre-propose-decisions.md`).
- `pnpm db:up` for the integration test.

## Success Criteria

- [ ] Integration: total-success publish-now → `status = PUBLISHED`, `publishedAt` set, `PostPublished` in the outbox, second `/start` rejected.
- [ ] Unit: two hops in one UoW; non-total outcome refused; OCC conflict returns an error; already-`PUBLISHED` retry is idempotent.
- [ ] `startPublishing` / `markAsPublished` have production callers; `status` no longer in `UpdatePostCommandSchema`.
- [ ] Lint / tsc / fitness at 0/0.
