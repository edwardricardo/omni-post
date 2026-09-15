# Pre-propose decisions — post-publish-status-integrity (N-COR-1)

**Phase**: pre-propose product gate · **Date**: 2026-09-14 · **Branch**: `workstream/post-publish-status-integrity` (tip = `origin/main` `31e2a2ad`) · **Store**: openspec
**Input**: `explore.md` (bug confirmed; code-quality verdict; DoD option (a) corrected).
**Status**: all five product questions signed by Edward. The proposer MUST honour these verbatim and MUST NOT re-interview or re-litigate them.

---

## The confirmed defect (from explore.md, not re-derived here)

The publish-now saga's `UpdatePostStatusStep` (`packages/shared/src/saga.ts:865-946`) routes the terminal status transition through the content-only `post.update` command; `apps/api/src/cqrs/handlers/PostCommandHandlers.ts:220-234` drops `status`/`publishedAt`. Net effect: the post is published to the provider, but the aggregate stays `DRAFT` while the saga reports `COMPLETED`, and the re-publish guards never trip (a silent no-op that can double-publish). The aggregate promotion methods `startPublishing` / `markAsPublished` / `markAsFailed` (`PostAggregate.ts`) are DEAD — zero production callers. The FSM (`PublishStatus.ts`) forbids a direct `DRAFT → PUBLISHED` transition; `PUBLISHING` is a mandatory intermediate.

---

## Q1 — Transition mechanism · SIGNED: synchronous command from the saga step

The saga step invokes a dedicated status-transition use case that loads the aggregate, calls its promotion methods, and persists via Unit of Work. The `PostPublished` domain event is emitted to the outbox **in the same transaction** as the state mutation, as an EFFECT of the command — never as the mechanism that sets the status.

**Canon basis** (this is a canon determination, not a free choice):

- ARCHITECTURE_CANON §CQRS/Commands — "State changes go through the aggregate — never `repository.update({ field })` directly." Routing the transition through `post.update` IS the defect.
- ARCHITECTURE_CANON §CQRS Bus — "One implementation only … No parallel Prisma path."
- ARCHITECTURE_CANON §Saga/Outbox coupling (Richardson) — "Domain events emitted via outbox in the SAME DB transaction as saga state mutation."

The event-projection alternative (a consumer projecting the status asynchronously) is **rejected** as a canon violation: it would set aggregate state outside the aggregate command, via a second asynchronous write path — exactly what "one implementation, no parallel path" forbids.

## Q2 — Schema migration · SIGNED: none

`status` and `publishedAt` already exist as columns. The fix is forward-only code; no Prisma schema change, no migration.

## Q3 — Production data-repair / backfill · SIGNED: not applicable, no backfill

omni-post has no production environment — it is an application in development, and the standing premise is tear-down-and-rebuild if necessary (recorded durably). There are no published-but-`DRAFT` historical rows to reconcile. The fix is forward-only; the change ships **no** backfill or reconciliation script.

## Q4 — FSM policy · SIGNED: two-hop `DRAFT → PUBLISHING → PUBLISHED` in one UoW

The transition wires the dead aggregate methods in order (`startPublishing()` then `markAsPublished()`) inside a single Unit of Work. `PUBLISHING` keeps its meaning; **no FSM canon change, no ADR**. The design reconciles the OCC token across the two version bumps within the one transaction. The `DRAFT → PUBLISHED` direct-hop ADR alternative is rejected (it would erase the `PUBLISHING` state's meaning and is a canon change the explore already advised against).

## Q5 — Partial-failure semantics · SIGNED: SPLIT (out of scope for N-COR-1)

N-COR-1 fixes the confirmed defect — the **total-success** case (all channels publish, the post must reach `PUBLISHED`). The status-transition command MUST accept the publish outcome (which channels succeeded) so that partial-failure handling has a clean seam, but N-COR-1 does **not** model partial-failure policy.

Partial failure — what status a post takes when N channels publish and M fail — is a genuine product + domain-model decision (the FSM has no `PARTIALLY_PUBLISHED` state today; modelling it "the right way" means a new state or a per-channel status entity = an ADR). It becomes its own slice (**N-COR-2**) with its own ADR and product decision. Rationale for the split: coupling a correctness bug-fix (post stuck `DRAFT` after full success) with inventing a new domain model would put the bug-fix on the critical path of a product decision.

---

## Handoff to sdd-propose

Proposal scope: the two-hop synchronous status-transition use case invoked by the saga step, wiring the dead promotion methods, one UoW, `PostPublished` via outbox in the same transaction, and the re-publish guards tripping correctly on the persisted terminal state. Non-goals: schema migration, backfill, partial-failure modelling (N-COR-2). State which fitness functions (#1-#41) the change interacts with, and a rollback plan.
