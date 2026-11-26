# Architecture Canon — Hexagonal · DDD · CQRS · UoW · Saga · DI

**Owner:** Maintainers
**Reference:** [ARCHITECTURE_CANON_REFERENCE.md](ARCHITECTURE_CANON_REFERENCE.md), read as a file: the rationale, the examples and how to extend these rules.

---

## Architecture — Hexagonal (Ports & Adapters)

**Dependency direction is always inward. Outer layers import inner. Never the reverse.**

```text
Routes → Application → Domain ← (never imports from) → Infrastructure
```

- `domain/` imports **nothing** external — no Prisma, no Fastify, no Redis, no BullMQ, no SDKs
- `application/` imports **domain, ports and the shared kernel only** — no concrete adapters, no infrastructure classes
- `infrastructure/` imports application + domain + external libs
- Routes call **use cases only**: the composition root resolves the use cases a route plugin needs and passes them in as the plugin's options. A route module never reaches the Prisma client, the container (`fastify.container.resolve`, `TOKENS`), a repository, an adapter or a provider. It imports the domain for its types and passes primitives; the use case builds the value objects
- Ports (interfaces) live in `packages/ports/` — technology-free names (`PostRepository` not `PrismaPostPort`). A port imports domain types, `@shared/types` and the `Result` and `UseCaseError` vocabulary of `@core/application/UseCase`, and nothing else of the core
- Gate: `pnpm check:architecture` (dependency-cruiser; local battery and CI). Its baseline `.dependency-cruiser-known-violations.json` only shrinks: a violation it does not list fails, and so does a listed entry that no longer occurs

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
- Validate on construction; an invalid input returns a domain error as `Result`
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
- Extend the base `BaseDomainEvent` class

### Repositories (Ports)

- Return **domain objects** — never raw Prisma types outside infrastructure
- `findById` returns `Result<T, EntityNotFoundError>` — never `T | null`
- Command repo (`PostRepository`) is separate from query repo (`PostQueryRepository`)
- No DTOs in or out of a command repository — that is the use case's job; a query repository returns DTOs (§CQRS)

---

## CQRS

**Commands change state. Queries read state. Never mix.**

### Commands

- Return `Result<void, UseCaseError>` or `Result<EntityId, UseCaseError>` — never a full object graph
- Load aggregate → call aggregate method → save via repo via Unit of Work
- Zero `findMany`, `select`, or read operations inside command handlers beyond loading the aggregate
- State changes go through the aggregate — never `repository.update({ field: value })` directly

### Queries

- Return typed **DTOs** — never domain objects
- Zero `save`, `create`, `update`, `delete` calls — not even incidentally
- Zero domain events emitted
- May bypass domain layer and query read model directly via `PostQueryRepository`

### CQRS Bus

- CQRSBus handlers delegate to Application layer use cases, the one implementation — **never** call `prisma.*` directly, no parallel Prisma path

---

## Unit of Work

**Every mutating use case MUST use UoW. No exceptions for new code.** Queries (read-only) do not need UoW.

- `unitOfWork?: UnitOfWork` is the LAST constructor parameter, optional so a unit test can construct the use case without it
- DI container MUST pass `container.resolve<UnitOfWork>(TOKENS.UnitOfWork)` to every mutating use case
- ALL repository writes and event dispatch run inside the transaction callback — **never** write to a repository outside it in production code
- **Never** put external API calls (provider APIs, email, etc.) inside the transaction — only DB writes
- `PrismaUnitOfWork` uses `AsyncLocalStorage` — repositories auto-detect the active transaction via `PrismaUnitOfWork.getTransactionClient()`
- **When the work returns a `Result` whose `err` must abort the transaction, use `executeResultInTransaction`, not `executeInTransaction`** (ADR-0023): `ok` commits, `err` rolls back and is returned unchanged as a value, and a genuine `throw` still propagates. `executeInTransaction` remains correct for work that signals failure by raising
- The template of a mutating use case, and why there are two shapes, are in this section's reference

---

## Event-Driven Architecture

- Domain event → Outbox write — **in the same DB transaction** as the aggregate save
- Outbox relay uses `SELECT FOR UPDATE SKIP LOCKED` — no double-dispatch
- After dispatch, mark the event published atomically: one `UPDATE` sets its `publishedAt` (`OutboxEvent` has no status column)
- Integration events carry **only** primitive-serializable data — no domain objects in BullMQ payloads
- Every consumer handler is **idempotent** — processing twice = same result as processing once
- Every dispatched event type has a registered schema version

---

## Saga Pattern

Before a saga is written or changed (`packages/shared/src/saga.ts`, `apps/api/src/saga/` or a file that calls `defineSaga`), read [SAGA_CANON.md](SAGA_CANON.md): it holds the saga rules and their reference.

---

## Dependency Injection

**This is the canon for ALL dependency injection in the codebase. Any new code, and any code being modified, MUST follow it.**

- Every new dependency gets a `TOKENS.MyDependency` symbol, registered in the composition root only
- **Only a composition root may import a singleton or construct an adapter.** The composition root is `apps/api/src/infrastructure/container/**` (and the bootstrap `apps/api/src/index.ts`, which passes the singleton into `setupContainer`)
- Every other unit — services, adapters, repositories, processors, route handlers, workers — **RECEIVES its dependencies by constructor injection** and never reaches for a global
- **Never `import { prisma } from "@infra/prisma"` outside the composition root** (fitness #21). Take `constructor(private readonly prisma: PrismaClient)` and have the root pass `container.resolve(TOKENS.PrismaClient)`. The same rule applies to any other singleton/global (Redis, queues, caches): inject the port, don't import the instance
- **A class that already receives a port must USE that port** — never inject a repository and then also call `prisma.*` directly. If the port lacks a method you need, add it to the port + its adapter; do not bypass it
- Lifecycle: repositories, use cases and the Unit of Work are singletons; the Unit of Work keeps no transaction state (the active transaction lives in `AsyncLocalStorage`)
- No `new ConcreteClass()` inside domain or application constructors. Allowed `new` in domain: Value Objects from primitives, Domain Events — nothing else
- **Each deployable has its OWN composition root** at its entry point (`apps/api`, `apps/workers`); the domain, the application and the ports live in shared `packages/` (`@core/*`) and are **never duplicated**
- A worker that needs business logic resolves the **same** use case from its container; it does not re-implement it and does not touch Prisma directly
- Background consumers may run in-process in `apps/api` or as a separate `apps/workers` executable — both are canon as long as the application core is shared
- The reference implementation, the known deviation and the sources are in this section's reference
