# ADR-0007: Dependency Injection — Composition Root with 130+ tokens

- **Status**: Accepted
- **Date**: 2026-05-15
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

Hexagonal architecture (ADR-0002) requires that **only one place in the
codebase** constructs concrete adapters and wires them to ports. Every
other module receives its dependencies via constructor injection. Two
failure modes are unacceptable:

1. **Hidden dependencies.** A use case that
   `import { prisma } from "@infra/prisma"` reaches outside its
   declared interface; it cannot be tested without booting Prisma, and
   the dependency graph becomes invisible to static analysis.
2. **Multiple composition roots.** If `apps/api` instantiates
   adapters in `apps/api/src/index.ts` AND in
   `apps/api/src/cqrs/CqrsBus.ts` AND in
   `apps/api/src/sagas/SagaEngine.ts`, configuration drift is
   inevitable — three places to update when a port surface changes,
   three places where a singleton might leak.

The codebase has ~130 distinct dependencies as of S5 closure: 30+ ports

- 20+ use cases + 10+ application services + 10+ adapters + cross-
  cutting concerns (CachePort, BackgroundTaskScheduler,
  AuditEmitterPort, …).

## Decision

**Adopt Mark Seemann's "Composition Root per Executable" pattern. One
composition root per deployable (`apps/api`, `apps/workers`); the
shared application core is never duplicated.**

### Composition root

- Path: `apps/api/src/infrastructure/container/` (api), and the
  equivalent in `apps/workers/src/container/` for the worker
  executable.
- Bootstrap (`apps/api/src/index.ts`) creates the container, calls
  `setupServices(container)` + `setupBillingUseCases(container)` etc.,
  and resolves the Fastify app from it. The bootstrap is the ONLY
  place that imports the `prisma` singleton — every other unit takes
  `PrismaClient` via constructor.

### TOKENS table

- A constant `TOKENS` exported from `apps/api/src/infrastructure/container/types.ts`
  declares ~130 `Symbol.for(...)` identifiers, one per dependency
  (e.g., `TOKENS.PrismaClient`, `TOKENS.PlatformCredentialService`,
  `TOKENS.AccountBillingRepository`, …).
- Every constructor that needs DI receives `container.resolve(TOKENS.X)`
  at the composition root — not in the consumer.

### Lifecycle

- **Repositories** → singleton (stateless adapters around `PrismaClient`).
- **Use cases / application services** → singleton (stateless after
  construction).
- **UnitOfWork** → **transient** (one instance per request — never
  singleton; AsyncLocalStorage requires fresh context per request).
  See ADR-0005.

### Rules

- **Routes resolve use cases only** —
  `fastify.container.resolve(TOKENS.X)` — never repositories, never
  `prisma`. Enforced by fitness `#1 No Prisma singleton imports in
routes` + `#21 No Prisma singleton imports outside composition
roots`.
- **A class that already receives a port MUST use that port** — never
  inject a repository and also call `prisma.*` directly (the
  "paradox" antipattern). If the port lacks a method, add it to the
  port + adapter; don't bypass.
- **Application core is shared across executables** — `apps/api` and
  `apps/workers` resolve the SAME use case from their own containers;
  the use case lives in `packages/core/application/` (delivery-
  mechanism-agnostic) and is NEVER duplicated.

## Rationale

1. **Static dependency graph.** The composition root reads as a
   declarative wiring spec. A reviewer scans it once to understand
   what depends on what; there are no "hidden imports" of `prisma`.
2. **Testability.** Use cases test against in-memory port fakes;
   tests never touch the DI container or boot Prisma.
3. **Swap-ability.** Replacing a port adapter (Prisma → Drizzle,
   BullMQ → RabbitMQ) is N file changes in the composition root +
   the new adapter — zero touch to use cases.
4. **Cross-deployable reuse.** `apps/workers` resolves
   `PublishPostUseCase` from its container the same way `apps/api`
   does. The use case lives in `@core/application/posts/` — single
   source of truth.
5. **Fitness function enforcement.** `#21 No Prisma singleton imports
outside composition roots` makes the rule structurally
   unbypassable. The CI gate had hard-zero count from S5 closure
   forward.

## Alternatives Considered

- **No DI container — manual instantiation everywhere.** Rejected:
  with 130+ deps, manual instantiation chains explode (`new
GatewayBillingService(new PrismaAccountBillingRepository(prisma),
new PrismaSubscriptionBillingRepository(prisma), …)`) — every
  call-site duplicates the chain.
- **`tsyringe` or `inversify` (decorator-based DI).** Considered.
  Rejected because we don't want `experimentalDecorators` on for
  domain/application code (it's a TypeScript stage-2 feature, fragile
  with TS 5+ ESM, and adds magic). The lightweight `Container` we
  use is ~100 LOC, decorator-free.
- **Global singletons + service locator.** Rejected: hides
  dependencies, makes tests order-dependent, defeats the goal of
  declared interfaces.

## Consequences

**Positive**

- All ~130 dependencies are visible in the composition root in one
  place. Reading `setupServices.ts` is reading the architecture.
- New deps follow a deterministic template: add TOKEN, add
  `container.register(TOKEN, () => new Adapter(...))`. ~10 lines per
  dependency.
- The pattern is mechanical enough that Claude / new devs can
  contribute new deps reliably.
- Cross-deployable reuse "just works" — the same use case resolved
  from two containers is genuinely the same singleton (within the
  executable; across executables they're different instances by
  design — own process, own Prisma client).

**Negative / costs**

- Composition root file (`setupServices.ts`) is ~900 LOC of
  registrations. Considered acceptable: it's read-only/append-only
  configuration; the alternative is hidden-import chaos.
- Each new dep requires a TOKEN declaration + a registration block.
  Boilerplate but mechanical.
- Onboarding cost: devs must learn the "resolve from container at
  routes, inject via constructor everywhere else" rule. Mitigated by
  fitness functions.

## Revisit if

If we add a third executable beyond `apps/api` and `apps/workers`
(e.g., MCP server, CLI ops), we evaluate whether the composition root
pattern still scales or whether we factor shared wiring into a
`packages/composition/` package that the executables consume. The
ports + use cases stay unchanged; only the wiring layer moves.

## Risks and Mitigations

| Risk                                                          | Mitigation                                                                                                                                               |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev imports `prisma` singleton in a non-composition-root file | Fitness `#21 No Prisma singleton imports outside composition roots` hard-zero in CI.                                                                     |
| Route resolves a repository instead of a use case             | Fitness `#1 No Prisma singleton imports in routes` + code review heuristic. `*Routes.ts` files use `resolve(TOKENS.<UseCase>)`.                          |
| UoW registered as singleton by mistake                        | Test in DI bootstrap that `container.resolve(TOKENS.UnitOfWork) !== container.resolve(TOKENS.UnitOfWork)` (different instances).                         |
| Composition root drifts between executables                   | `apps/workers` and `apps/api` share use cases via `@core/application/` import path. The wiring layer is per-executable; the wired modules are shared.    |
| TOKEN name collisions                                         | All TOKENS are `Symbol.for("Name")` — collisions are impossible across processes (symbol identity), and intentional re-use within a process is explicit. |

## References

- Mark Seemann, "Dependency Injection Principles, Practices, and Patterns" — Manning 2019
- Seemann, "Composition Root" blog post — https://blog.ploeh.dk/2011/07/28/CompositionRoot/
- "Explicit Architecture" — Herberto Graça, https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/
- OmniPost `CLAUDE.md §Dependency Injection`
- Composition root: `apps/api/src/infrastructure/container/setupServices.ts` + `setupBillingUseCases.ts` + `setupGuardrailUseCases.ts`
- Token table: `apps/api/src/infrastructure/container/types.ts`
- Fitness `#21`: `.github/workflows/fitness.yml` + CLAUDE.md §Automated Compliance Checks
