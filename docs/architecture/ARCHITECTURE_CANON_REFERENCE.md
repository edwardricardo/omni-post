# Architecture Canon — Reference

**Owner:** Maintainers
**Rules:** [ARCHITECTURE_CANON.md](ARCHITECTURE_CANON.md). This file holds their rationale, their examples and how to extend them, each under the heading of the section it belongs to.

---

## Unit of Work

### Reference: the template and the two shapes

```typescript
// Required pattern for ALL mutating use cases:
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

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

The `let result` capture in the pattern above is what makes the distinction load-bearing: it stores an `err` in a variable and lets the callback RESOLVE, so the Unit of Work sees a success and Prisma COMMITS. For a single-statement save that is harmless — the statement either ran or it did not. For a multi-statement save (an aggregate whose update writes the row, then its content, then its media, then its outbox rows) a failure raised on the JS side after the first statement is caught by the repository, returned as `err`, and the partial write commits. `executeResultInTransaction<T, E>(fn)` closes that hole with the same seam: `ok` commits, `err` rolls back and is returned unchanged as a value, and a genuine `throw` still propagates. The abort signal is the `Result` itself, so the application core keeps returning `Result` and gains no raised control flow — this is fitness **#4**'s own documented remove-when, satisfied without adding a name to its exception list. `executeInTransaction` is unchanged and remains correct for work that signals failure by raising.

---

## Dependency Injection

### Reference: the reference implementation, the known deviation and the sources

Reference implementation: the bulk-schedule worker (`apps/api/src/bulk-scheduling/bulkScheduleWorker.ts`); decided in ADR-0007. The workers' composition root is `apps/workers/src/container/workerContainer.ts`.

A container referenced outside the Composition Root is a Service Locator (Seemann): it hides a module's dependencies until run time, the failure fitness **#43** was written for. Fitness **#1** keeps the `prisma` singleton out of route files, and `pnpm check:architecture` holds the rest. Decided in ADR-0033.

**The deviation, stated rather than hidden.** Route modules and one route-handler module still resolve from the container with `fastify.container.resolve(TOKENS.X)`. Each is an entry of the known-violations baseline `.dependency-cruiser-known-violations.json` under `routes-no-container`, which holds their count (this paragraph names none, because the workstream below shrinks it), beside the route modules that still reach Prisma, a repository, an adapter or a provider. The entries may only shrink: a new one fails the check, and so does a listed one that no longer occurs. The routes workstream, whose open rows are ARCH-20 and ARCH-22 in `docs/product/plan/cross-cutting.md`, removes them context by context. The five per-request guards (`rbacMiddleware`, `adminAuthMiddleware`, `customerOrAdminAuth`, `integrationAuthMiddleware`, `auditMiddleware`) resolve from `request.server.container` too, so they need their own injected dependencies before the container can leave Fastify: converting the route plugins alone does not remove it.

Sources: Explicit Architecture (the application core is delivery-mechanism-agnostic and shared across entry points: HTTP API, queue workers, CLI); Mark Seemann, "composition root per executable". Whether a consumer runs in-process or as a separate executable is an operational choice (independent scaling and isolation against simplicity). Injecting a repository and also calling `prisma.*` is the "paradox" anti-pattern.

---

## How to extend

Adding new architecture patterns or amending these rules:

1. **New aggregate / VO / domain event** → follow the DDD section. New invariants live in the entity method, not the use case.
2. **New use case** → mutating ones use UoW (mandatory). Reads return DTOs, not domain objects.
3. **New saga** → use `defineSaga()` factory; classify every step; declare countermeasures explicitly. Saga that doesn't fit the canon → write an ADR justifying the deviation.
4. **New port / adapter** → port in `packages/ports/` (technology-free name), adapter in infrastructure. Register in the composition root only. What a port may import is in §Hexagonal; the reason is that the application owns its ports (Cockburn: the application defines them; Martin: the boundaries live in the use-case ring).
5. **New DI token** → `TOKENS.MyDependency` symbol, register in `setupContainer`. Never `new` a concrete in domain or application code.
6. **Amending a canon rule** → ADR required (`docs/technical/ADR-NNNN-<slug>.md`, in the shape of the latest ones). Update [ARCHITECTURE_CANON.md](ARCHITECTURE_CANON.md) with the new wording, link the ADR.

Companion fitness checks live in `docs/development/FITNESS_FUNCTIONS.md §Inventory`:

- `#1` no Prisma in routes · `#2` domain framework-free · `#6` CQRS handlers without raw prisma · `#21` no prisma singleton outside composition roots · `#22` no `@layer application` in apps/api/src · `pnpm check:architecture` (dependency-cruiser rules + the shrink-only baseline).
