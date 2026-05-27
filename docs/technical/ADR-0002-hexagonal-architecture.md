# ADR-0002: Hexagonal Architecture (Ports & Adapters) over Modular Fastify

- **Status**: Accepted
- **Date**: 2026-05-15
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

OmniPost is a multi-tenant SaaS publishing platform that integrates with 11
social providers (X, Instagram, Facebook, YouTube, TikTok, Snapchat,
Telegram, Pinterest, LinkedIn, Bluesky, Threads), two payment gateways
(Stripe + Paddle), and runs a fleet of BullMQ workers consuming the same
business logic that the Fastify HTTP API exposes. Two stylistic choices
were on the table when the project was bootstrapped:

1. **Modular Fastify** (`controller-service-repository` per feature folder).
   Standard TypeScript+Fastify+Next.js 2026 canon. Fast onboarding for an
   average TS dev; 5 files in a single folder per feature.
2. **Hexagonal Architecture** (Cockburn's "Ports & Adapters"): pure domain
   - application use cases at the core, infrastructure adapters at the
     edges, dependencies pointing inward.

The product surface requires the same business logic to run from at least
**two delivery mechanisms** today (HTTP routes in `apps/api`, BullMQ
consumers running in-process inside `apps/api` or as a separate
`apps/workers` executable) and we expect a third delivery mechanism
(scheduled CLI ops, MCP server in §F2-API-9) before end of 2026. Each
mechanism MUST resolve the same use case from a DI container — there is
**no acceptable place for duplicated business logic**.

## Decision

**Adopt Hexagonal Architecture with three explicit layers:**

```text
Routes (HTTP) ┐
              ├─→  Application (use cases)  ←─  Domain (entities, VOs, ports)
Workers       ┤
CLI / MCP     ┘                ↑
                               │
                  Infrastructure (adapters: Prisma, BullMQ, SDKs, …)
```

- **Domain** (`packages/core/domain/`) imports nothing external — no
  Prisma, no Fastify, no Redis, no BullMQ, no SDKs. It defines entities,
  value objects, aggregates, domain events, and **repository ports**
  (interfaces) that name what the application needs without specifying
  technology.
- **Application** (`packages/core/application/`) imports domain only. It
  defines use cases that orchestrate domain objects and external services
  through ports. No concrete adapters, no framework imports.
- **Infrastructure** (`apps/api/src/infrastructure/`, `packages/adapters/`,
  `packages/providers/`) imports application + domain + external libs. It
  implements the ports (Prisma adapters, BullMQ adapters, provider SDKs,
  HTTP routes, …).

**Composition root per executable.** `apps/api` and `apps/workers` each
own a DI composition root that wires concrete adapters to ports. Use cases
themselves are **shared, never duplicated** across deployables.

## Rationale

1. **Shared business logic across delivery mechanisms.** The same
   `PublishPostUseCase` runs from a route handler **and** from a BullMQ
   consumer **and** (future) from an MCP tool — without duplication. The
   modular Fastify model forces re-implementation per executable.
2. **Testability.** Use cases test against in-memory port fakes — no
   Prisma, no BullMQ, no provider SDKs in unit tests. Mutation testing
   (Stryker, see ADR-0012) is feasible because the domain is pure.
3. **Swap-ability.** Replacing Fastify with Hono, or Prisma with Drizzle,
   touches infrastructure adapters only. The 56+ mutating use cases stay
   the same.
4. **Boundary enforcement automated by CI.** `dependency-cruiser` rules
   `core-domain-no-framework` and `core-application-no-infrastructure`
   make the layers structurally impossible to violate (see ADR-0012).

## Alternatives Considered

- **Modular Fastify** (`apps/api/src/modules/<feature>/<feature>.{routes,
controller,service,repository}.ts`). Rejected: collapses delivery into
  business logic; cross-deployable reuse requires duplication; testing
  business logic requires booting Fastify; "swap Fastify" becomes a
  rewrite.
- **Layered architecture without ports** (controller → service → DAL
  directly). Rejected: tighter coupling, harder to fake at the seam, no
  natural place for cross-cutting policy (Result types, UoW,
  AsyncLocalStorage tx threading).
- **Clean Architecture (Uncle Bob) with usecase-interactors + DTOs at
  every boundary.** Rejected as over-engineered for our scale; we adopt
  the **simpler hexagonal variant** (port = interface, adapter = class
  implementing it) and reserve DTO mapping for cross-context boundaries.

## Consequences

**Positive**

- The same business logic powers HTTP, workers, and future delivery
  mechanisms (CLI, MCP) without duplication.
- Boundary violations are caught at CI by `dependency-cruiser` — not at
  code review.
- Onboarding a new bounded context follows a deterministic template:
  entity + port in domain, use case in application, adapter + route in
  infrastructure.

**Negative / costs**

- **Higher cognitive overhead.** A trivial feature ("Posts") spreads
  across ≥5 files in 4 directories. Documented in
  `NORMALIZATION_ROADMAP.md §0.1` as an acknowledged cost.
- **Slower onboarding for devs unfamiliar with hexagonal/DDD.** Average
  TS dev expects modular Fastify; ramp-up is 2-3× longer.
- **More DI wiring.** Each new port + adapter requires a TOKEN +
  composition-root registration (see ADR-0007).

## Revisit if

The cost-benefit tilts negative if a future delivery mechanism is dropped
(e.g., we decide BullMQ workers will only ever be in-process inside
`apps/api`) AND the team size stays small (<5 devs). At that point, the
boundary enforcement still has value for tests, but the executable-per-
composition-root layer can be collapsed.

## Risks and Mitigations

| Risk                                                                 | Mitigation                                                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Developers bypass hexagonal "for speed" and import Prisma in a route | `dependency-cruiser` fitness function `core-domain-no-framework` + `#21 No Prisma singleton imports outside composition roots` block PRs.    |
| Domain entity grows infrastructure leaks ("just one Prisma type")    | `#2 Domain layer is framework-free` fitness function greps for `prisma\|fastify\|redis\|bullmq` in domain — hard-zero.                       |
| Application services grow direct infra imports                       | `core-application-no-infrastructure` depcruise rule + ADR-0011 closure: every @layer application file lives in `packages/core/application/`. |
| Onboarding lag for new devs                                          | ADR set (ADR-0002..ADR-0013) + CLAUDE.md split (Normalization §1.2) reduces context cost.                                                    |

## References

- Cockburn, "Hexagonal Architecture" — https://alistair.cockburn.us/hexagonal-architecture
- Vaughn Vernon, "Implementing Domain-Driven Design" — Addison-Wesley 2013
- Mark Seemann, "Dependency Injection Principles, Practices, and Patterns" — Manning 2019
- OmniPost `CLAUDE.md §Architecture — Hexagonal (Ports & Adapters)`
- `dependency-cruiser` config: `.dependency-cruiser.cjs` rules `core-domain-no-application`, `core-domain-no-framework`, `core-application-no-infrastructure`
