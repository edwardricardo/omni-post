# ADR-0003: Domain-Driven Design — Entities, Value Objects, Aggregates, Domain Events

- **Status**: Accepted
- **Date**: 2026-05-15
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

ADR-0002 establishes Hexagonal Architecture as the macro structure. That
decision answers "where do things live" but not "what shape do the things
take". Without prescribed shapes for the domain objects, two failure modes
emerge:

1. **Anaemic domain.** Services hold all the logic; entities are plain
   data bags. Equivalent to having no domain layer — invariants leak
   everywhere.
2. **God objects.** Single entity holds all logic for a bounded context;
   modifications cascade unpredictably.

OmniPost has a non-trivial domain (Posts with publish lifecycle, Accounts
with billing/auth state, Channels with credentials, Mentions, DSAR
requests, Saga aggregates, …). Each needs a clear shape that the codebase

- CI can validate.

## Decision

**Adopt the canonical DDD building blocks from Evans + Vernon:**

- **Entities** have identity via typed Value Object (`PostId`, never bare
  `string`). State changes through methods only
  (`post.scheduleForPublishing(time)` not `post.status = 'SCHEDULED'`).
  Invariants enforced inside the entity method, not in the use case. No
  repository, service, or adapter references inside an entity.
- **Value Objects** are immutable (`readonly` properties, no setters).
  Validation in constructor; throw domain error on invalid input. Equality
  by value, not reference. Wrap primitives at every domain boundary
  (`new ShortCode('abc123')` not bare `string`).
- **Aggregates** reference other aggregates **by ID only**
  (`channelId: ChannelId`, not `channel: Channel`). Aggregate root is the
  only public entry point — no direct child mutation from outside.
  Collect domain events internally — dispatch only after persistence (via
  Unit of Work, see ADR-0005).
- **Domain Events** have past-tense names (`PostPublished`,
  `CrisisModeEntered`). Immutable payload, no methods beyond constructor.
  Always carry `aggregateId` + `occurredAt: Date`. Extend base
  `DomainEvent` class.
- **Repositories (Ports)** return domain objects — never raw Prisma types
  outside infrastructure. `findById` returns `Result<T, NotFoundError>`
  — never `T | null` (see ADR-0006). Command repos (`PostRepository`) are
  separate from query repos (`PostQueryRepository`, see ADR-0004).

## Rationale

1. **Invariants live with the data they protect.** Entity methods enforce
   business rules (`PostStatus` transition validation) at the seam where
   data is mutated, not scattered across N services that all need to
   remember the rules.
2. **Compiler-enforced identity.** Typing `accountId: AccountId` instead
   of `string` prevents mixing identifiers across aggregates (a frequent
   real-world bug source in flat-typed codebases).
3. **Eventual consistency via domain events.** Aggregates emit events
   inside a Unit of Work transaction; consumers react to events
   asynchronously through the outbox pattern (see ADR-0008). No coupling
   between command-side aggregates.
4. **Boundary clarity for AI agents and code review.** When Claude or a
   reviewer asks "where does this rule belong?" the answer is
   deterministic: invariant → entity method; cross-aggregate workflow →
   use case; cross-context choreography → domain event + handler.

## Alternatives Considered

- **Anaemic domain with rich service layer.** Rejected: services bloat
  past 500 LOC, invariants get re-checked at every entry point, refactors
  break N call-sites at once.
- **Active Record-style entities tied to Prisma.** Rejected: violates
  ADR-0002 hexagonal boundary; entities would depend on Prisma, blocking
  pure unit tests and the goal of cross-deployable reuse.
- **Functional Core / Imperative Shell (no entities, just records +
  functions).** Considered seriously — has merit for purity but loses the
  natural method-on-entity affordance for invariants. Rejected as
  ergonomically inferior for this codebase's size and team.

## Consequences

**Positive**

- Invariants are local to entities; changes do not cascade across N
  services.
- Typed identifiers prevent cross-aggregate ID mixing at compile time.
- Domain events provide natural extensibility for cross-context reactions
  (audit logs, analytics, notifications) without modifying aggregates.
- Repository ports return domain types — the use cases never touch raw
  Prisma rows.

**Negative / costs**

- More boilerplate per entity: VO classes, factory methods, event types,
  port interfaces — vs a plain `interface Post {…}`.
- Junior devs unfamiliar with DDD need an explicit example to follow;
  ADR-0002 + ADR-0003 + a reference entity (e.g., `Post.ts`) are the
  on-ramp.
- Discipline required: anyone can put `post.status = 'CANCELED'` and
  bypass `cancel()` method invariants. Mitigated by code review +
  `#3 Zero any in domain` fitness function (limits `as any` escapes).

## Revisit if

If the cost of VO + event boilerplate stops paying its weight (i.e.,
invariants are NOT being added because the ceremony is too high), we
revisit by considering a lighter-weight pattern (e.g.,
`Brand<string, 'PostId'>` instead of class-based VO). The criterion is
**rate of invariant additions**: if we add ≥5 new invariants per quarter,
DDD pays; if it stops, we re-evaluate.

## Risks and Mitigations

| Risk                                                             | Mitigation                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entity grows infrastructure leaks (Prisma types, etc.)           | Fitness `#2 Domain layer is framework-free` blocks any `prisma\|fastify\|redis\|bullmq` import in `apps/api/src/domain/` — and the post-S5 canon has domain in `packages/core/domain/` which depcruise enforces. |
| Domain events not dispatched (silent failures)                   | Outbox pattern (ADR-0008) co-locates event write with aggregate save in same DB tx; `SELECT FOR UPDATE SKIP LOCKED` relay guarantees at-least-once.                                                              |
| Anaemic creep — services accumulate logic that belongs on entity | Code review heuristic: any `if (post.status === X)` in a service is a candidate for `post.canDoY()` method on the entity.                                                                                        |
| VO validation too lenient (e.g., empty `ShortCode`)              | Constructor throws `InvariantError` on invalid input; covered by unit tests at 90% coverage for domain (CLAUDE.md target).                                                                                       |

## References

- Evans, "Domain-Driven Design: Tackling Complexity in the Heart of Software" — Addison-Wesley 2003
- Vernon, "Implementing Domain-Driven Design" — Addison-Wesley 2013
- Vernon, "Domain-Driven Design Distilled" — Addison-Wesley 2016
- OmniPost `CLAUDE.md §Domain-Driven Design`
- Reference entities: `packages/core/domain/src/entities/*.ts`
- Reference VOs: `packages/core/domain/src/value-objects/*.ts`
