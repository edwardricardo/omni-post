# ADR-0004: CQRS — Command vs Query separation

- **Status**: Accepted
- **Date**: 2026-05-15
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

OmniPost has asymmetric read/write characteristics:

- **Writes** are infrequent, transactionally critical (publish, schedule,
  cancel, billing actions), and require domain-level invariant enforcement
  (ADR-0003) + Unit of Work (ADR-0005).
- **Reads** are 10-100× more frequent (dashboards, analytics, list views,
  search), need different shape per UI (PostListDTO ≠ PostDetailDTO ≠
  internal Post aggregate), and benefit from query-side optimizations
  (selective columns, joins, caching) that would distort the command-side
  model.

Putting both through the same `PostRepository.findById` →
`Post.toDTO()` path produces three smells:

1. Over-fetching (load full aggregate to render a list item).
2. DTO mapping logic accumulates in entities (`toListDTO()`, `toDetailDTO()`,
   `toAnalyticsDTO()`).
3. Read paths accidentally mutate (e.g., a "list view" use case calling
   `post.markAsViewed()` and saving).

## Decision

**Adopt CQRS: separate Command and Query stacks. The same database, the
same Prisma schema, but two distinct sets of repositories, use cases, and
return shapes.**

### Commands

- Use case name ends in `UseCase` (`CreatePostUseCase`, `PublishPostUseCase`).
- Returns `Result<void, DomainError>` or `Result<EntityId, DomainError>`
  — **never a full object graph**.
- Flow: load aggregate via command repo → call aggregate method → save
  via command repo inside a UoW transaction (ADR-0005). Domain events
  emit via outbox in the same tx (ADR-0008).
- Zero `findMany` / `select` / read-only operations inside command
  handlers.
- State changes go through aggregate methods — never
  `repository.update({field: value})` directly.

### Queries

- Use case name ends in `Query` (`GetPostWithThreadQuery`,
  `ListPostsGlobalQuery`).
- Returns typed **DTOs** — never domain entities.
- Reads from a `*QueryRepository` port (e.g., `PostQueryRepository`,
  distinct from `PostRepository`). May bypass domain entities entirely
  and query the read model directly.
- Zero `save` / `create` / `update` / `delete` — not even incidentally
  (e.g., no "track-last-viewed" side effects).
- Zero domain events emitted.

### CQRSBus

- A single CQRSBus dispatches both Commands and Queries by name.
- Handlers delegate to the Application layer (Use cases / Queries).
  **Never** call `prisma.*` directly from a bus handler — one
  implementation only, the Application layer.

## Rationale

1. **Independent evolution.** Adding `PostListItemDTO` with a different
   shape requires a new `*Query` + adapter, not a touch to the command
   side. Pricing changes do not break list views.
2. **Performance.** Query repos can issue narrow `SELECT id, title FROM
...` joins; command repos fetch the full aggregate. Both legitimate,
   both kept apart.
3. **Read scalability without complicating writes.** If a read model
   needs ElasticSearch / materialized views / a separate replica, that
   change lives entirely in the query stack. The command stack is
   untouched.
4. **Side-effect proof.** A reviewer scanning a `*Query.ts` file knows
   structurally there is no mutation. The `#6 CQRS handlers don't touch
Prisma directly` fitness function enforces it.

## Alternatives Considered

- **Single repository per aggregate (CRUD-style).** Rejected for the
  reasons listed in Context: over-fetching, DTO mapping leakage,
  accidental mutation in reads.
- **Event Sourcing as the primary persistence model.** Considered — the
  saga + outbox infrastructure (ADR-0008) already touches an event log.
  Full event sourcing was rejected as over-engineered for the current
  scale; we adopt CQRS without event sourcing. The two are orthogonal
  patterns; CQRS does not require ES.
- **Hand-rolled split (services + dedicated DAOs).** Rejected: same
  result as adopting CQRS terminology but without the discipline of
  enforced separation at the use-case / handler level.

## Consequences

**Positive**

- Read DTOs evolve independently of the domain model. UI teams can
  add `PostCalendarDTO` without touching the command path.
- Performance optimizations on queries are isolated; they cannot
  introduce write-side regressions.
- Code review is structurally cleaner: a file with `*Query` in its name
  is presumed read-only.

**Negative / costs**

- Two repository ports per aggregate (`PostRepository` +
  `PostQueryRepository`) instead of one. More files.
- Some duplication between command-side `Post.toDTO()` and query-side
  `PostListItemDTO` shapes. Mitigated by sharing primitive types in
  `@shared/types` but accepted as a conscious trade-off (DRY at the
  shape level is less important than independence of evolution).
- Junior devs may instinctively reach for "the repository" and need
  guidance to find the right side (query vs command).

## Revisit if

If we ever introduce ElasticSearch / a separate read replica / a CQRS
read-model projection that diverges materially from the command write
schema, the CQRS terminology becomes load-bearing. Until then, the cost
is small. If we discover that 90% of queries match 90% of commands
shape-wise (i.e., DTOs are nearly identical to entities), the
duplication cost is real and we revisit by collapsing the smallest
contexts to a single repository.

## Risks and Mitigations

| Risk                                        | Mitigation                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Query handlers accidentally mutate          | Fitness `#6 CQRS handlers don't touch Prisma directly` + naming convention (`*Query.ts` is presumed read-only).                   |
| Command + Query repos drift in field naming | Both repos consume the same Prisma schema; field renames propagate via Prisma generate + tsc.                                     |
| DTO shape duplication                       | Shared primitive types in `@shared/types`; DTO assembly stays in the query adapter, not in domain.                                |
| CQRSBus becomes a god object                | Bus only dispatches by name; handler logic lives in dedicated `*UseCase` / `*Query` classes. No business logic in the bus itself. |

## References

- Greg Young, "CQRS Documents" — http://cqrs.files.wordpress.com/2010/11/cqrs_documents.pdf
- Vernon, "Reactive Messaging Patterns with the Actor Model" (CQRS chapter)
- OmniPost `CLAUDE.md §CQRS`
- Reference command: `packages/core/application/posts/CreatePostUseCase.ts`
- Reference query: `packages/core/application/posts/GetPostWithThreadQuery.ts`
- Fitness function `#6` (`grep -rn "prisma\." apps/api/src/cqrs/handlers/`)
