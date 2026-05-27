# Architecture Canon — Hexagonal · DDD · CQRS · UoW · Saga · DI

> Authoritative rules for system architecture in omni-post. Auto-loaded via
> `@docs/architecture/ARCHITECTURE_CANON.md` in CLAUDE.md.

**Owner:** Platform engineering
**Loaded:** every session (Claude Code `@`-import, depth 1)

---

## Architecture — Hexagonal (Ports & Adapters)

**Dependency direction is always inward. Outer layers import inner. Never the reverse.**

```text
Routes → Application → Domain ← (never imports from) → Infrastructure
```

- `domain/` imports **nothing** external — no Prisma, no Fastify, no Redis, no BullMQ, no SDKs
- `application/` imports **domain only** — no concrete adapters, no infrastructure classes
- `infrastructure/` imports application + domain + external libs
- Routes import **use cases only** — never repositories, never Prisma directly
- **Never** `import { prisma } from "@infra/prisma"` in a route file — resolve from DI: `fastify.container.resolve(TOKENS.XRepository)`
- Ports (interfaces) live in `packages/ports/` — technology-free names (`PostRepository` not `PrismaPostPort`)
- Concrete adapters are instantiated **only** in the DI composition root (`Container.ts`)

---

## Domain-Driven Design

**The domain speaks business language. If a domain expert wouldn't recognize the word, rename it.**

### Entities

- Identity via typed Value Object: `PostId` not `string`
- State changes through methods only: `post.scheduleForPublishing(time)` not `post.status = 'SCHEDULED'`
- No repository, service, or adapter references inside an entity
- Enforce invariants inside the entity method — not in the use case

### Value Objects

- All properties `readonly` — no setters, ever
- Validate on construction, throw domain error on invalid input
- Equality by value, not reference
- Wrap primitives: `new ShortCode('abc123')` not bare `string`

### Aggregates

- Reference other aggregates **by ID only**: `channelId: ChannelId` not `channel: Channel`
- Aggregate root is the only public entry point — no direct child mutation from outside
- Collect domain events internally — dispatch only after persistence (via Unit of Work)
- Never call a repository or service from inside the aggregate

### Domain Events

- Past tense names: `PostPublished`, `CrisisModeEntered`
- Immutable payload, no methods beyond constructor
- Always carry: `aggregateId`, `occurredAt: Date`
- Extend base `DomainEvent` class

### Repositories (Ports)

- Return **domain objects** — never raw Prisma types outside infrastructure
- `findById` returns `Result<T, NotFoundError>` — never `T | null`
- Command repo (`PostRepository`) is separate from query repo (`PostQueryRepository`)
- No DTOs in or out — that is the use case's job

---

## CQRS

**Commands change state. Queries read state. Never mix.**

### Commands

- Return `Result<void, DomainError>` or `Result<EntityId, DomainError>` — never a full object graph
- Load aggregate → call aggregate method → save via repo via Unit of Work
- Zero `findMany`, `select`, or read operations inside command handlers
- State changes go through the aggregate — never `repository.update({ field: value })` directly

### Queries

- Return typed **DTOs** — never domain objects
- Zero `save`, `create`, `update`, `delete` calls — not even incidentally
- Zero domain events emitted
- May bypass domain layer and query read model directly via `PostQueryRepository`

### CQRS Bus

- CQRSBus handlers delegate to Application layer use cases — **never** call `prisma.*` directly
- One implementation only — the Application layer use cases. No parallel Prisma path.

---

## Unit of Work

**Every mutating use case MUST use UoW. No exceptions for new code.**

All 56 mutating use cases in the project use Unit of Work. New mutating use cases
must follow the same pattern. Queries (read-only) do not need UoW.

```typescript
// Required pattern for ALL mutating use cases:
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

export class MyUseCase {
  constructor(
    private readonly someRepository: SomeRepository,
    private readonly unitOfWork?: UnitOfWork // LAST param, optional for tests
  ) {}

  async execute(input: Input): Promise<Result<Output, UseCaseError>> {
    // Validation, domain logic...

    const doWork = async (): Promise<Result<Output, UseCaseError>> => {
      // ALL repo writes + event dispatch go here
      await this.someRepository.save(aggregate);
      return ok(output);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<Output, UseCaseError> = ok(undefined) as Result<Output, UseCaseError>;
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "...",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
```

### UoW Rules

- **Never** write to a repository outside of `executeInTransaction` in production code
- **Never** put external API calls (provider APIs, email, etc.) inside the transaction — only DB writes
- UoW parameter is `optional` for backward compatibility in unit tests
- DI container MUST pass `container.resolve<UnitOfWork>(TOKENS.UnitOfWork)` to every mutating use case
- `PrismaUnitOfWork` uses `AsyncLocalStorage` — repositories auto-detect the active transaction via `PrismaUnitOfWork.getTransactionClient()`

---

## Event-Driven Architecture

- Domain event → Outbox write — **in the same DB transaction** as the aggregate save
- Outbox relay uses `SELECT FOR UPDATE SKIP LOCKED` — no double-dispatch
- After dispatch, mark event `PROCESSED` atomically
- Integration events carry **only** primitive-serializable data — no domain objects in BullMQ payloads
- Every consumer handler is **idempotent** — processing twice = same result as processing once
- Every dispatched event type has a registered schema version

---

## Saga Pattern

**Every saga in this repo is canon-aligned to Richardson (microservices.io) + Azure Architecture Center "Saga design pattern". Steps are classified, the pivot is identified, countermeasures are explicit. Definition-time enforcement via `defineSaga()` factory in `packages/shared/src/saga.ts` — sagas that compile are canon-by-construction.**

### Step classification (Azure §4-8)

Every step MUST declare its `class` — a discriminated union enforced by the TS compiler:

- **`compensable`** — pre-pivot. MUST implement `compensate()` (TS rejects classes without it). Idempotent. On saga failure pre-pivot, compensable steps are walked in reverse and their `compensate()` is invoked.
- **`pivot`** — point of no return. NO `compensate()`. If retries exhausted → saga FAILED, no rollback (the pivot's external side-effects, e.g. enqueued provider jobs that may have already published, cannot be canonically undone).
- **`retryable`** — post-pivot. NO `compensate()`. Idempotent forward-recovery only; retried until success or terminal failure.

### `pivotStepIndex` (Azure §5)

Every `SagaDefinition` MUST declare `pivotStepIndex` (the array index of the pivot step). Use the `defineSaga()` factory, which forces preCommit / pivot / postCommit segments and derives the index — TS rejects passing a `PivotStep` into preCommit, a `RetryableStep` as pivot, etc.

```typescript
const saga = defineSaga({
  id: "my-saga",
  name: "My Saga",
  version: "1.0.0",
  preCommit: [validateStep, createStep], // CompensableStep[]
  pivot: scheduleStep, // PivotStep
  postCommit: [waitStep, finalizeStep], // RetryableStep[]
});
```

### Countermeasures (Azure §15-20)

Sagas with concurrent execution risk MUST attach the relevant countermeasures via `step.countermeasures`:

- **`SemanticLock`** — application-level lock keyed by aggregate. Rejects a second saga from progressing while the first holds the lock. Use when 2+ sagas can race on the same aggregate.
- **`RereadCheck`** — confirms aggregate state hasn't changed pre-write. Activated by the engine before `step.execute()`; returns `{stillValid:false}` aborts the step. Use to close dirty-read windows between read-and-write steps.
- **`VersionCheck`** — Optimistic Concurrency Control via aggregate version. Saga step emits `expectedVersion` in the command; use case rejects with `CONFLICT` if persisted version has advanced. Use for retryable post-pivot updates that race with manual writes.

### Compensation (Richardson + Azure §3)

- Compensation is **idempotent and retryable**.
- Compensations execute in **reverse order** of forward steps, and ONLY on `compensable` steps strictly before `pivotStepIndex`. Engine enforces this — a compensation walk past the pivot is a canon violation that the engine refuses by construction.
- "No no-op compensations" — every compensable step's `compensate()` is real undo logic. If a step has nothing to undo (e.g., pure validation), declare its compensate as `{ success: true }` explicitly so the canon classification is self-documenting.

### Terminal state (Azure §9 + Richardson)

Sagas MUST reach `COMPLETED`, `FAILED`, or `COMPENSATED`. Infinite `RUNNING` is a canon violation enforced by the timeout checker in `SagaManagerLifecycle` (default 30 min). Recovery scheduler resumes due retries on every tick (5 s).

### DedupeKey

Deterministic: `cmd-${sagaId}-${stepId}[-compensate]`. Never `randomUUID()`. The CQRS bus dedupes by command ID; the outbox dedupes by message ID — both rely on this determinism.

### Outbox coupling (Richardson Outbox)

Domain events emitted via outbox in the SAME DB transaction as saga state mutation. Consumer dedupe via `messageId` unique constraint. Saga + Outbox are tightly coupled — Richardson explicitly says "the Saga and Domain event patterns create the need for this pattern."

### Re-execution guard

```typescript
const TERMINAL = ["COMPLETED", "FAILED", "COMPENSATED"];
if (TERMINAL.includes(saga.status)) return;
```

Engine checks this at the top of `executeSaga` — terminal sagas never re-execute regardless of how the engine is invoked (recovery checker, event resume, manual re-trigger).

---

## Dependency Injection

**This is the canon for ALL dependency injection in the codebase. Any new code, and any code being modified, MUST follow it. The F1-API-3 bulk-schedule worker + the `refactor/prisma-di-migration` workstream are the reference implementations.**

- **130+ tokens** — every new dependency gets a `TOKENS.MY_DEPENDENCY` symbol
- Registration in `Container.ts` composition root only
- Lifecycle: repositories → singleton, use cases → singleton, UoW → **transient**
- No `new ConcreteClass()` inside domain or application constructors
- Allowed `new` in domain: Value Objects from primitives, Domain Events — nothing else

### Composition root is the ONLY place that wires concretes

- **Only a composition root may import a singleton or construct an adapter.** The composition root is `apps/api/src/infrastructure/container/**` (and the bootstrap `apps/api/src/index.ts`, which passes the singleton into `setupContainer`). Every other unit — services, adapters, repositories, processors, route handlers, workers — **RECEIVES its dependencies by constructor injection** and never reaches for a global.
- **Never `import { prisma } from "@infra/prisma"` outside the composition root.** Take `constructor(private readonly prisma: PrismaClient)` and have the root pass `container.resolve(TOKENS.PrismaClient)`. The same rule applies to any other singleton/global (Redis, queues, caches): inject the port, don't import the instance. Enforced by fitness **#21** (hard-zero).
- **Routes resolve use cases only** — `fastify.container.resolve(TOKENS.X)` — never repositories, never `prisma`. Enforced by fitness **#1**.
- **A class that already receives a port must USE that port** — never inject a repository and then also call `prisma.*` directly (the "paradox" anti-pattern). If the port lacks a method you need, add it to the port + its adapter; do not bypass it.

### Composition root per executable; the application core is shared, never duplicated

- Use cases (the application layer) are **delivery-mechanism-agnostic** and are **shared** across entry-points (HTTP API, queue workers, CLI) — **never duplicated** (Explicit Architecture; see canon index). The domain + application + ports live in shared `packages/` (`@core/*`) so every deployable consumes the same core.
- **Each deployable has its OWN composition root** at its entry point (`apps/api` and `apps/workers` each wire the shared core) — Mark Seemann, "composition root per executable" (see canon index). A worker that needs business logic resolves the **same** use case from its container; it does not re-implement it and does not touch Prisma directly.
- Background consumers may run **in-process** in `apps/api` (resolving use cases from `app.container`, e.g. the repurpose/triage/trend/bulk-schedule consumers) **or** as a separate `apps/workers` executable with its own composition root — both are canon as long as the application core is shared, not duplicated. The choice is operational (independent scaling/isolation vs simplicity).

---

## How to extend

Adding new architecture patterns or amending these rules:

1. **New aggregate / VO / domain event** → follow the DDD section. New invariants live in the entity method, not the use case.
2. **New use case** → mutating ones use UoW (mandatory). Reads return DTOs, not domain objects.
3. **New saga** → use `defineSaga()` factory; classify every step; declare countermeasures explicitly. Saga that doesn't fit the canon → write an ADR justifying the deviation.
4. **New port / adapter** → port in `packages/ports/` (technology-free name), adapter in infrastructure. Register in the composition root only.
5. **New DI token** → `TOKENS.MY_DEPENDENCY` symbol, register in `setupContainer`. Never `new` a concrete in domain or application code.
6. **Amending a canon rule** → ADR required (see `docs/technical/ADR-NNNN-*.md` template via ADR-0001). Update this file with the new wording, link the ADR.

Companion fitness checks live in `CLAUDE.md §Automated Compliance Checks`:

- `#1` no Prisma in routes · `#2` domain framework-free · `#6` CQRS handlers without raw prisma · `#21` no prisma singleton outside composition roots · `#22` no `@layer application` in apps/api/src.
