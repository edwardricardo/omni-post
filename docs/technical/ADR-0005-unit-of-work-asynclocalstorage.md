# ADR-0005: Unit of Work with `PrismaUnitOfWork` + `AsyncLocalStorage`

- **Status**: Accepted
- **Date**: 2026-05-20
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

Mutating use cases typically need to write to multiple aggregates within
the same logical operation, with atomic guarantees:

- `InitiateGatewaySwitch`: creates a `GatewaySwitchEvent`, updates the
  `Account` pending fields, updates the `AccountSubscription`
  `cancelAtPeriodEnd`, emits an audit event.
- `PublishPost`: updates the `Post` status, writes to the outbox, may
  write to `Channel` health metrics.
- `RotateEncryptionKey`: writes a new `PlatformEncryptionKey` row, emits
  an audit event.

Two failure modes are unacceptable:

1. **Partial commit.** Account marked as `pendingGatewaySwitch=true` but
   the `GatewaySwitchEvent` write failed → inconsistent state, no way to
   recover.
2. **Domain events emitted before persistence.** Consumer reacts to
   `PostPublished` event but the post itself is not in the DB →
   integrity-broken downstream.

Prisma offers two transaction APIs:

- **Array form**: `prisma.$transaction([op1, op2, op3])` — atomic but
  requires all operations declared upfront; no conditional logic; no
  composition with use cases.
- **Closure form**: `prisma.$transaction(async (tx) => { ... })` — atomic,
  allows arbitrary logic inside, but the `tx` client needs to be threaded
  through every repository call. Passing `tx` as a parameter to every
  repo method is intrusive and error-prone.

Concrete pain point hit during S3.4 refactor: `GatewayBillingService`
had 6 `$transaction([...])` arrays that mixed control flow with
persistence — impossible to test without mocking Prisma deeply, and
impossible to migrate to hexagonal without restructuring.

## Decision

**Adopt Vernon's Unit of Work pattern, implemented as `PrismaUnitOfWork`
backed by Node's `AsyncLocalStorage` for transaction threading.**

```typescript
// Required pattern for ALL mutating use cases:
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
          "…",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
```

- `PrismaUnitOfWork.executeInTransaction(fn)` wraps `fn` in
  `prisma.$transaction(async (tx) => …)` AND stores `tx` in an
  `AsyncLocalStorage` slot.
- Every Prisma repository adapter calls
  `PrismaUnitOfWork.getTransactionClient() ?? prisma` to pick the
  active transaction automatically — no `tx` parameter passing.
- UoW parameter is `optional` for backward compatibility in unit tests
  (tests with port fakes don't need a real transaction).
- DI container MUST pass `container.resolve<UnitOfWork>(TOKENS.UnitOfWork)`
  as `transient` (one instance per request — never singleton).

### Boundaries

- **Never** write to a repository outside `executeInTransaction` in
  production code.
- **Never** put external API calls (Stripe SDK, email send, BullMQ
  enqueue) inside the transaction — only DB writes. External effects
  happen **after** the tx commits (via the outbox pattern, ADR-0008).
- **Queries do not need UoW.** Read-only use cases (CQRS `*Query` files)
  use the bare `PrismaClient`.

## Rationale

1. **Atomicity without intrusion.** Repository methods stay clean —
   they don't accept a `tx` parameter. The active transaction is found
   via `AsyncLocalStorage` automatically.
2. **Test ergonomics.** Unit tests inject an in-memory port fake and
   skip the UoW (parameter is optional). Integration tests inject the
   real `PrismaUnitOfWork` against a test DB.
3. **Domain events safety.** Outbox writes share the tx with aggregate
   saves; consumers read from outbox **after** commit. No
   event-before-persistence inconsistency possible.
4. **Composable with the saga engine.** Saga steps that need atomic
   mutations wrap their step bodies in UoW; the saga engine handles
   compensation if a non-DB side-effect fails post-tx.
5. **Concrete S3/S4 win.** S3.4c-canon converted 6
   `$transaction([...])` arrays in `GatewayBillingService` to UoW
   closures with port calls — service became framework-free and
   relocatable to `@core/application/billing/`.

## Alternatives Considered

- **Pass `tx: Prisma.TransactionClient` as a parameter to every
  repository method.** Rejected: intrusive (every repo signature
  grows a `tx?` param), error-prone (forget to pass it = silent leak
  outside tx), incompatible with hexagonal port interfaces (the
  port shape would have to know about Prisma).
- **Use Prisma's array form `$transaction([…])` everywhere.**
  Rejected: composes badly with use case logic (conditional ops, early
  returns, error handling in the middle of the tx).
- **Manual transaction management with raw SQL.** Rejected:
  reinvents Prisma's transaction primitives + loses type safety.
- **Distributed transactions / 2PC across services.** Out of scope —
  OmniPost is a monolith with one DB; intra-service tx atomicity is
  sufficient. Cross-service consistency is solved by the saga pattern
  (ADR-0008), not 2PC.

## Consequences

**Positive**

- All 56 mutating use cases in the codebase share one transaction
  pattern. Reviewers know exactly where to look for tx boundaries.
- Repository adapters never see `tx` parameters; they pick the active
  one via AsyncLocalStorage. Clean port interfaces.
- Outbox + UoW give us guaranteed-eventually-consistent domain events
  with at-least-once delivery (post-commit).
- Tests run without booting Prisma (port fakes + skip UoW).

**Negative / costs**

- `AsyncLocalStorage` has minor performance overhead (Node 16+
  optimization makes it negligible in practice; measured <1ms per
  request).
- Devs new to the pattern can forget the closure form and call repo
  outside UoW — caught only at integration tests, not at typecheck.
  Mitigated by code review heuristics and the documented "doWork"
  closure pattern in CLAUDE.md.
- Long-running operations inside UoW can hold tx locks; external API
  calls are explicitly forbidden inside UoW (Stripe, BullMQ, email).

## Revisit if

If we adopt a non-PostgreSQL store (e.g., DynamoDB read model) for some
aggregates, the `PrismaUnitOfWork` abstraction stops covering them. The
fix is to lift `UnitOfWork` to a generic port (already done — it lives
in `@core/domain/repositories/Repository.ts`) and have multiple
`*UnitOfWork` implementations registered against a token strategy. The
use cases don't change.

## Risks and Mitigations

| Risk                                                                 | Mitigation                                                                                                                                                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Devs call repos outside UoW                                          | Code review heuristic: any mutating use case must follow the "doWork closure" pattern. Integration tests exercise the UoW path.                                                           |
| External side effects inside UoW (BullMQ enqueue, Stripe call)       | Documented forbidden in CLAUDE.md §Unit of Work + ADR-0005 itself. Outbox pattern (ADR-0008) is the canonical mechanism for post-commit external effects.                                 |
| UoW marked `singleton` instead of `transient`                        | DI container `container.register<UnitOfWork>(TOKENS.UnitOfWork, () => …, false)` — third arg `false` = transient. Caught at startup if misregistered (per-request leak detection in dev). |
| AsyncLocalStorage broken by a third-party library that loses context | Node 18+ stabilized async context; we pin Node version. If a lib breaks it, the integration tests fail loudly.                                                                            |

## References

- Vernon, "Implementing DDD" — Chapter 9, Modules + Unit of Work
- Node `AsyncLocalStorage` docs — https://nodejs.org/api/async_context.html
- Prisma transactions — https://www.prisma.io/docs/orm/prisma-client/queries/transactions
- OmniPost `CLAUDE.md §Unit of Work`
- Implementation: `apps/api/src/infrastructure/persistence/PrismaUnitOfWork.ts`
- Reference use case: `packages/core/application/billing/GatewayBillingService.ts` (S3.4c)
