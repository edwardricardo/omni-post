# ADR-0033: Layer boundaries — routes receive their dependencies from the composition root, the core owns its ports, use cases take primitives

- **Status**: Accepted
- **Date**: 2026-10-05
- **Deciders**: Edward
- **Supersedes**: —
- **Superseded by**: —
- **Amends**: [ADR-0007](ADR-0007-di-composition-root.md) (its rule "Routes resolve use cases only
  — `fastify.container.resolve(TOKENS.X)`": a route now receives its use cases from the composition
  root); [ADR-0013](ADR-0013-three-logger-factory-model.md) (its rejected "Logger-as-port"
  alternative, for the application core)
- **Related**: [ADR-0032](ADR-0032-architecture-gate-dependency-cruiser.md) (the gate that enforces
  these boundaries), [ADR-0002](ADR-0002-hexagonal-architecture.md) (the layers),
  [ADR-0023](ADR-0023-unit-of-work-result-aware-transaction.md) (the Unit of Work the new write use
  cases run in)

## Context

PR #408 made the architecture gate read the whole import graph (ADR-0032). On that graph the old
boundaries policy rejected 509 edges, and each was checked on 2026-10-05 against six primary
sources:

| Source                                                      | What it settles here                                                                                                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Martin, "The Clean Architecture"                            | "Source code dependencies can only point inwards. Nothing in an inner circle can know anything at all about something in an outer circle." Boundary interfaces live in the use-case circle.        |
| Cockburn, "Hexagonal architecture"                          | The application defines its ports. An adapter converts outside input into the application's API with primitives: its FIT example parses the text into a number, then calls `app.discount(amount)`. |
| Seemann, "Service Locator is an Anti-Pattern"               | Service Locator "hides a class' dependencies, causing run-time errors instead of compile-time errors".                                                                                             |
| Seemann, "Composition Root"                                 | "A DI Container should only be referenced from the Composition Root. All other modules should have no reference to the container."                                                                 |
| Seemann, "Instrumentation with Decorators and Interceptors" | Logging can wrap a component from outside: "I never changed the original implementation of any of the components".                                                                                 |
| `@fastify/awilix` README                                    | The Fastify ecosystem's norm is the opposite: `req.diScope.resolve(...)` inside the handler.                                                                                                       |

The verdict: 460 edges are allowed (the infrastructure ring may import itself and everything
inward; the old policy was stricter than the canon), 43 are real violations, and 6 needed a
decision. Five questions were open.

**1. Routes resolve their dependencies from the container.** ARCHITECTURE_CANON §Dependency
Injection and ADR-0007 have each route call `fastify.container.resolve(TOKENS.X)`: the Fastify
norm, and Seemann's Service Locator. Measured on 2026-10-05, 76 of the 78 route modules under
`apps/api/src` (the `*Routes.ts` files and `ai/routes.ts`) import `TOKENS` and resolve from the
container — 279 calls, 274 of them once, at registration; `outboxAdminRoutes.ts` resolves inside
its handlers, and `assetRoutes.ts:251` and `reportRoutes.ts:270` per request. The other two,
`queueRoutes.ts` and `contentRoutes.ts`, do not resolve, but the `ContentHandlers.ts` that
`contentRoutes.ts` delegates to does, per request (`:122,126,130`). The boundaries report recorded
74 of the 76: it missed `ai/routes.ts`, outside its `*Routes.ts` pattern, and `reportRoutes.ts`,
whose per-request resolve takes a repository (`ScheduledReportRepository`, `:270-272`), an R2-class
site the report did not see either. No route plugin
declares an options type — 75 are `FastifyPluginAsync` constants — but the parameter shape already
exists twice: `healthRoutes` takes `{ redis, cacheManager, storageAdapter }` (`index.ts:543`), and
`registerOAuthRoutes` takes its collaborators (`index.ts:659`).

The cost is measured here, not argued: fitness #43 exists because 22 route-test harnesses
registered `TOKENS.ApiMetrics` as `undefined`, and `Container.ts:86` handed the `undefined` back at
resolution instead of failing, to be dereferenced later on the customer login path.

**2. Five guards resolve per request** from `request.server.container`: `rbacMiddleware.ts:21`,
`adminAuthMiddleware.ts:76,225`, `customerOrAdminAuth.ts:86`, `integrationAuthMiddleware.ts:78` and
`auditMiddleware.ts:72`. The `container` decoration (`index.ts:280`, typed optional in
`types/fastify.d.ts:62`) cannot leave Fastify while they read it.

**3. The core imports the concrete logger (R10).** Six services in `packages/core` —
`GatewayBillingService`, `AiRequestService`, `RoleManagementService`, `ComplianceService`,
`DataRetentionService` and `DlqArchivalService` — call `createLogger` from `@observability/logger`,
which returns a `pino.Logger` (`packages/observability/logger/src/index.ts:48`): 24 `error`, 6
`warn` and 4 `info` calls. Pino is an outer ring. ADR-0013 had rejected a logger port for
application services as ceremony ("the factory is the abstraction, not the instance"), and the
four `info` calls break LOGGING_CANON's rule that the application layer logs `WARN` or `ERROR`
only.

**4. Routes reach into domain values (R11).** Six edges in five route files use value objects
instead of passing primitives to a use case: `AdminActorId` and `EmailAddress` (with
`normalizeEmail`) in the account, admin-auth and project routes, and the channel and account ids in
`channelRoutes.ts`. The sixth is `customReportRoutes.ts`, which serves five report-schema constants:
the one file of the five that does not also reach Prisma or a repository, and whose edge may prove
to be data vocabulary instead (P2).

**5. Ports import an application type (R9).** Three ports import `UseCaseError` from
`@core/application/UseCase`. Cockburn's ports belong to the application, and Martin's boundaries
live in the use-case circle, so this is consistent with the canon; only the `@layer domain` label
that `packages/ports` carries says otherwise.

## Decision

1. **D-P1 = B: route plugins receive their dependencies as parameters from the single composition
   root** (`apps/api/src/index.ts` and `apps/api/src/infrastructure/container`). A route module
   neither imports `TOKENS` nor calls `container.resolve`. It receives use cases and queries, plus
   the HTTP-side collaborators the adapter itself needs, such as the scheduler that sends the
   heartbeat of its own SSE connection; never the Prisma client, a repository, an adapter, a
   provider client or a cache manager. Decided by Edward on 2026-10-05; option A, route-level resolution as canon, is rejected
   (Alternatives).
2. **The guards get their dependencies from the root as well.** Until they do, the `container`
   decoration stays on Fastify for them alone; the route rule does not depend on it.
3. **D-R10: the core takes a `LoggerPort`.** It lives in `packages/ports`, owned by the application
   like every port, and offers the two levels LOGGING_CANON admits in the application layer,
   `warn` and `error`, with pino's `(context, message)` argument order that all 34 calls already
   use. An adapter over `@observability/logger` implements it, and the composition root injects it
   into the six services. Each of the four `info` calls is resolved under LOGGING_CANON in the same
   change.
4. **P2b: routes pass primitives; the use case builds the value objects.** The R11 edges are
   repaired in the slices that give their routes use cases.
5. **Ports are application-owned.** A port may import domain types and `@core/application/UseCase`,
   and ADR-0032's rule says exactly that. The `@layer domain` label of `packages/ports` stays —
   CODING_STANDARDS admits no fourth value and maps pure contracts to `domain` — and its mapping
   table gains a note stating the ownership.
6. **Staged, with the deviation stated.**
   - **Item (v), now:** PR #408 (the gate reads the graph) → **PR2** (the layer rules at `error`,
     the shrink-only baseline, `eslint-plugin-boundaries` retired, ARCHITECTURE_CANON §Dependency
     Injection rewritten to this target with the deviation state, the CODING_STANDARDS note on
     ports) → **PR3a** (the `LoggerPort`) → **PR3b** (the repairs that need no design:
     `healthRoutes` receives the root's repository adapter and queue — R4 and R5, and its R1 falls
     with R4, because it resolves `PrismaClient` only to build that adapter, `healthRoutes.ts:71-72`;
     `queueRoutes` receives a queue the root builds instead of importing `QUEUE_NAMES` from the
     queue adapter and constructing one, R5; a cache-administration port for the six
     `RedisCacheManager` methods `cacheStatsRoutes` calls, R6).
   - **The routes workstream, queued after N-TEST-1:** each route module moves to use cases and
     composition-root injection, area by area, as rows ARCH-1 to ARCH-22 of
     [MASTER_PLAN_ES.md](../product/MASTER_PLAN_ES.md) §5.12.
   - **The deviation, in plain terms:** until its area migrates, a route module keeps resolving
     from the container, 24 of them keep reaching Prisma, a repository or the email port, and five
     keep building value objects. Those edges are admitted only as entries of ADR-0032's baseline,
     which can only shrink; a new route module, or a new edge in an old one, fails the gate.
7. **R3 rides with the outbox slice.** The transaction that `outboxAdminRoutes.ts:73` opens moves
   into a use case with Unit of Work in the outbox area, not in item (v), because it moves fitness
   #40. Part B counts 13 seam sites today against a floor of 10, and four of them —
   `outboxAdminRoutes.ts:73`, `SchedulingPostHandlers.ts:249,349` and `SchedulingSlotHandlers.ts:418`
   — leave once their operations run in the Unit of Work, whose single site is
   `tenantTransaction.ts:55`. The slice that takes the count below 10 lowers the floor deliberately,
   with its red proof, and each slice that removes a seam file updates
   `tenantTransactionNesting.test.ts` in the same change: its `INDEPENDENT_BY_DESIGN` entry, and
   `SEAM_FILE_POPULATION` (16 today, a floor equal to the measured population).

## Rationale

1. **The cost of Service Locator has been paid in this repository.** A route's dependencies are
   invisible in its signature; a route suite assembles the production composition to register one
   plugin (`createRouteTestContainer`, which is `setupContainer` over the in-memory Prisma double);
   and a dependency left out of the wiring surfaced as an `undefined` deep in the login path
   (fitness #43) — the run-time error Seemann describes. A parameter makes the dependency list a type the compiler
   checks where the production root wires it.
2. **Most of the change is moving lines, not writing them.** The parameter shape is already in the
   tree, and 17 of the 25 route files the sizing covers build a `BaseRouteHandler` that already
   takes its dependencies by constructor: for them the resolves move from the plugin body to the
   root.
3. **A port keeps pino out of the core without moving the logs.** The calls report conditions the
   services absorb: `AiRequestService.ts:158` logs a failed subscription read and returns
   `{ allowed: true }` anyway, so a decorator around the service sees the same value whether the
   read succeeded or failed, and cannot log it. LOGGING_CANON already sanctions `WARN` and `ERROR`
   in the application layer; what changes is only who owns the interface.
4. **Primitives into the use case keep construction in one place.** HTTP, the workers and any later
   delivery mechanism build the same value objects the same way (ADR-0002's shared core).
5. **Staging keeps the route Edward fixed** — the Testing Refoundation, then the legal register,
   then the master plan in its order. The full migration is about 17,000 CODE lines; doing it now
   would displace N-TEST-1. The gate and its baseline stop the debt from growing meanwhile.

## Alternatives Considered

- **A: keep route-level resolution as our canon** — the current ARCHITECTURE_CANON text and the
  `@fastify/awilix` norm. Rejected: it is Service Locator, and its cost has been paid here (fitness
  #43). The ecosystem's norm is a convenience of the framework, not a boundary of the architecture.
- **Request-scoped resolution (`req.diScope`).** Rejected for the same reason: the same locator,
  one scope down.
- **Seemann's decorators for the core's logs.** Rejected: the calls report conditions a wrapper
  cannot see from the inputs and the returned value (Rationale 3), and LOGGING_CANON already admits
  these levels inside the application layer.
- **Keep `createLogger` in the core, as ADR-0013 chose.** Rejected: the factory returns a
  `pino.Logger`, so the core names an outer ring's type.
- **Migrate every route module now.** Rejected: about 17,000 CODE lines is some 54 slices of up to
  400; that belongs in the master plan's queue, not inside the Testing Refoundation.
- **Relabel `packages/ports` as `@layer application`.** Not chosen: the gate already enforces the
  ownership through its rule, and the relabel would touch 24 files with no effect the gate does not
  have.

## Consequences

**Positive**

- A route's dependencies are a declared parameter type, and a suite can pass fakes to the plugin
  directly.
- The core no longer names pino, and its logging is testable with a fake port.
- Each migrated area removes its baseline entries, so the deviation shrinks where everyone sees it.

**Negative / costs**

- **The deviation lasts until the workstream ends**: 76 route modules keep their container
  references, 24 their Prisma, repository or email-port edges and five their value-object
  construction, admitted only by the baseline.
- **ARCHITECTURE_CANON §Dependency Injection is rewritten in PR2** to this target, with the
  deviation state; until then, its sentence and ADR-0007's rule describe the old target.
- **LOGGING_CANON's factory table** names `@observability/logger` for `packages/**`; PR3a narrows
  that row so `packages/core` takes the `LoggerPort`.
- **CODING_STANDARDS' mapping table** gains the note on ports (PR2).
- **Route suites change shape.** The behaviour-heavy ones (`projectRoutes.test.ts`, 1,608 lines;
  `accountRoutes.test.ts`, 1,168) keep `createRouteTestContainer` and build the plugin's
  dependencies with the root's own function, 3 to 8 lines each, so their Prisma-semantics
  assertions keep running; fitness #43 is unaffected while suites call `createRouteTestContainer`.
- **Fitness #40's floor and the nesting test's population fall** with the outbox and scheduling
  slices, deliberately and with red proofs.
- **The workstream is large.** The 25 route files that reach Prisma, a repository, the email port
  or a value object: about 15,200 CODE lines (11,400–19,000) in 49 slices, 55 if the six that
  measure near 400 are split. The other 51 route modules: about 1,670 in 5 slices. A one-time
  route-dependency convention: about 40. The guards: not yet sized. Sites the classification missed
  and the sizing did not count — `reportRoutes.ts:270`, `providerOAuth.ts:25-35` (repositories as
  parameters, `new OAuthFlowStore` at `:32`) and `samlRoutes.ts:192` (`new SAML`) — are named in
  their rows.
- **Nine defects found by the sizing and its verification are queued, not fixed here**:
  [MASTER_PLAN_ES.md](../product/MASTER_PLAN_ES.md) §5.11 DEF-7 to DEF-15, SMELL-194 to SMELL-202.

## Revisit if

- The routes workstream is dropped, or postponed with no date: the baseline would never shrink,
  and option A is then re-decided openly instead of living on as a permanent list.
- A third executable needs the same route wiring: ADR-0007's revisit, a shared composition
  package.
- The application layer needs `info` logs: LOGGING_CANON changes first, then the port.
- A Fastify release gives plugins typed dependencies of its own that make the parameter convention
  redundant.

## Risks and Mitigations

| Risk                                                         | Mitigation                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The deviation becomes permanent                              | The workstream has ids in the master plan (§5.12), and stale baseline entries fail, so every repair shrinks the list in the same change                                                                                                                   |
| A plugin's dependency list and the root's wiring drift apart | The plugin's options are required fields, and `apps/api/src/index.ts` is compiled, so the root's call is type-checked. The test harnesses are not compiled (fitness #43's premise), so they build dependencies through the root's function, never by hand |
| A migration changes behaviour a route suite asserts          | Behaviour-heavy suites keep running over the in-memory Prisma double through the root's function; an assertion a slice cannot keep moves to a use-case or adapter test in the same change                                                                 |
| Fitness #40's floor is lowered to absorb a regression        | It falls only in the slice that moves a named seam site into the Unit of Work, with its red proof and the nesting test's entry removed                                                                                                                    |
| The four `info` calls disappear silently                     | PR3a resolves each one under LOGGING_CANON and says how in its body                                                                                                                                                                                       |
| The guards keep the container alive indefinitely             | They are their own row (ARCH-21), the prerequisite for removing the decoration                                                                                                                                                                            |

## Implementation notes (2026-10-05)

Item (v) delivered the first stage of decision 6 on 2026-10-05. PR2 shipped as `PR v-b`
(`workstream/item-v-rules`, `515487b9`) and `PR v-c` (`workstream/item-v-boundaries`, `63881f50`);
PR3a as `PR v-d1` (`workstream/item-v-logger-a`, `0986c8ad`) and `PR v-d2`
(`workstream/item-v-logger-port`, `beb017e1`); PR3b as `PR v-e1` (`workstream/item-v-cheap-repairs`,
`05f1d28f`), `PR v-e2` (`workstream/item-v-cheap-queue`, `33476917`) and `PR v-e3`
(`workstream/item-v-cheap-health`, `783aeebe`). The decisions stand as written; these notes record
where the code that shipped differs from their text.

**D-R10 shipped with no adapter class.** Decision 3 reads "An adapter over `@observability/logger`
implements it, and the composition root injects it into the six services." The port
(`packages/ports/src/LoggerPort.ts`) takes pino's own `(context, message)` order, with a
message-only overload per level, so the redacting `createLogger(name)` of
`apps/api/src/lib/logger.ts` satisfies it by construction, and the composition root passes that
logger directly (`setupBillingUseCases.ts:110`; `setupServices.ts:247,318,569,583`). Core entries
therefore carry the API factory's redaction and its `name` binding, which `PR v-d1` fixed in that
factory (its `bindings` formatter had dropped the name); `@observability/logger` never redacted, and
`packages/core` no longer imports it. Two suites
pin the choice: `apps/api/tests/unit/lib/loggerPortContract.type-test.ts`, compiled by the package's
`typecheck`, assigns the factory's logger to the port and rejects a message-first impostor through
`@ts-expect-error` (which fails as `TS2578` if a message-first port ever accepts it), and
`loggerPortContract.test.ts` writes through the port and reads back the name, the message, the
context fields, the `err` serialization and the redaction. Five services take the port by
constructor. The sixth, `DataRetentionService`, takes none: its one call was an `info` line that
repeated the `DATA_RETENTION_CLEANUP` audit entry. The four `info` calls went as follows:
`GatewayBillingService`'s two, because the invoice row and the subscription status already record
the dunning outcome and the recovery; `DlqArchivalService`'s, because the method returns its count
(the daily task discards it, which DEF-18 of [MASTER_PLAN_ES.md](../product/MASTER_PLAN_ES.md)
§5.11 queues with the port failures the service swallows); and `DataRetentionService`'s, for the
reason above.

**Decision 6, PR3b, as shipped.**

- **R4** (`PR v-e3`): `healthRoutes` receives `{ scheduler, checkers }` (`apps/api/src/index.ts:578-588`),
  not the root's repository adapter and queue. Decision 1 lets no route receive a repository, an
  adapter or a cache manager, and `CacheHealthChecker` takes the concrete `RedisCacheManager`
  (`packages/monitoring/health-checks/src/checkers/redis.ts:114-115`), so the root builds the six
  checkers over the objects it already owns — the repository adapter, `redis`, the cache manager,
  the publish queue adapter, the storage adapter and the provider registry — and the route keeps
  the probe policy (types, criticality) and starts and stops the health manager. R1 fell with it:
  the route no longer resolves `PrismaClient` or builds an adapter of its own, so
  `createPrismaRepoAdapter(` has one call (`index.ts:342`) and the scheduler task
  `db-prisma-connection-monitor` one owner. Before, the route's second adapter registered that id
  again, and registering an id replaces its task
  (`packages/observability/background-scheduler/src/default-scheduler.ts:59`).
- **R5** (`PR v-e2`): `queueRoutes` receives the publish `Queue` the root builds (`index.ts:358-367`,
  closed in the `onClose` hook at `:368-375`, registered at `:609`), typed as
  `Pick<Queue, "name" | "getJobCounts" | "getJobs" | "getJob" | "getJobLogs">` with a type-only
  `bullmq` import (`apps/api/src/admin/queueRoutes.ts:9,20-25`); the route imports neither
  `QUEUE_NAMES` nor the queue adapter. The construction moved from the route unchanged; DEF-25 of
  MASTER_PLAN_ES §5.11 queues what it drops from `REDIS_URL` and its overlap with the registry's
  adapter for the same queue.
- **R6** (`PR v-e1`): `cacheStatsRoutes` receives a `CacheAdminPort`
  (`packages/ports/src/CacheAdminPort.ts:47`), the six operations the routes call, each returning a
  `Result`. The root passes the `RedisCacheManager`, which satisfies the port structurally; the
  registration at `index.ts:701` is where the compiler checks it.
- **The deviation, measured on `783aeebe`:** 74 of the 78 route modules resolve from the container
  (76 when decided; `cacheStatsRoutes` and `healthRoutes` left it), 23 reach Prisma, a repository or
  the email port (24; `healthRoutes` left), and five build value objects. ADR-0032's baseline holds
  124 entries, 138 when `PR v-b` wrote it.

## References

- Alistair Cockburn, "Hexagonal architecture" — https://alistair.cockburn.us/hexagonal-architecture
- Robert C. Martin, "The Clean Architecture" (2012) —
  https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html
- Mark Seemann, "Service Locator is an Anti-Pattern" (2010) —
  https://blog.ploeh.dk/2010/02/03/ServiceLocatorisanAnti-Pattern/
- Mark Seemann, "Composition Root" (2011) — https://blog.ploeh.dk/2011/07/28/CompositionRoot/
- Mark Seemann, "Instrumentation with Decorators and Interceptors" (2010) —
  https://blog.ploeh.dk/2010/09/20/InstrumentationwithDecoratorsandInterceptors/
- `@fastify/awilix` README — https://github.com/fastify/fastify-awilix
- Vaughn Vernon, "Implementing Domain-Driven Design" — Addison-Wesley 2013 (application services
  take primitives and build the value objects)
- PR #408 — https://github.com/edwardricardo/omni-post/pull/408
- Research notes, measured or fetched on 2026-10-05 (the maintainer's tooling directory, not in the
  repository): `/root/.claude/omnipost-tools/research-2026-10-04/boundaries-violations-509.classified.json`
  (engram 1211), `boundaries-repair-plan.md`, and `boundaries-repair-sizing.md` (engram 1213), the
  source of every estimate above, in the same directory.
- Canon: [ARCHITECTURE_CANON.md](../architecture/ARCHITECTURE_CANON.md) §Dependency Injection,
  [LOGGING_CANON.md](../observability/LOGGING_CANON.md) §Logging & Observability,
  [CODING_STANDARDS.md](../development/CODING_STANDARDS.md) §@layer Standard Values,
  [CLAUDE.md](../../CLAUDE.md) fitness #40 and #43.
- Plan: [MASTER_PLAN_ES.md](../product/MASTER_PLAN_ES.md) §5.11 and §5.12;
  [roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md) SMELL-194 to
  SMELL-202; [TESTING_REFOUNDATION.md](../development/TESTING_REFOUNDATION.md) D49.
- Code: `apps/api/src/index.ts:279-280,543,659`; `apps/api/src/types/fastify.d.ts:62`;
  `apps/api/src/infrastructure/container/Container.ts:86`; `apps/api/src/health/healthRoutes.ts:38-75`;
  `apps/api/src/auth/providerOAuth.ts:25-35`; the five guards named in Context; the six services in
  `packages/core`; `packages/observability/logger/src/index.ts:48,52`.
