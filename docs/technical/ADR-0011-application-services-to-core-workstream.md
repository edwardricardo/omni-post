# ADR-0011: `application-services-to-core` workstream closure (S1'→S5)

- **Status**: Accepted
- **Date**: 2026-05-27
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

Following S0 (architectural framing) and S-Spine (decoupling of 6
inherited services), the project had **15 services tagged `@layer
application` living in `apps/api/src/<context>/`** but with direct
imports of `@infra/prisma`, `@adapters/*`, and `apps/api`-local
helpers (loggers, audit helpers). This was the inverted-dependency
smell that:

1. **Blocked cross-deployable reuse.** `apps/workers` could not
   resolve these services without pulling in apps/api's entire DI
   graph.
2. **Made application code untestable without booting Prisma /
   Fastify wiring.**
3. **Violated the depcruise rule** `core-application-no-
infrastructure` once we tried to relocate any of them — they
   carried infrastructure imports inline.

The workstream `application-services-to-core` was opened to relocate
the **9 port-blocked, inheritance-safe services** from `apps/api/src/
<context>/` to `packages/core/application/<context>/` with proper
ports extracted, while keeping the remaining 6 (which were Bucket B
"mechanisms/glue" or Bucket D "mis-labeled") as `@layer infrastructure`.

## Decision

**Relocate 9 application-layer services to `@core/application/
<context>/`. Extract ~30 new ports + ~25 new Prisma adapters. Add CI
fitness function `#22` to prevent regression.**

### Phases executed

| Phase     | Scope                                                                                   | Commits                                                   |
| --------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| S0        | Audit + roadmap framing (no code change)                                                | `18e86bd`                                                 |
| S-Relabel | 11 mis-labeled files → `@layer infrastructure`                                          | `c2fa48a`                                                 |
| S-Spine   | 6 application-layer subclasses decoupled from `AuditableService` base                   | `5d2d142`                                                 |
| S1'       | Billing/subscription cluster → `@core/application/billing/` (6 services + types)        | `98b6ccf` (canon) + `26018b7` (move)                      |
| S3.1      | `CredentialGroup` + `AccountCredentialGroup` extracted as `@core/domain` VOs            | `a102178`                                                 |
| S3.2      | `PlatformCredentialService` → `@core/application/security/` + 3 ports                   | `3d38d30` (canon) + `54a276b` (move)                      |
| S3.3      | `SettingsService` → `@core/application/settings/` + 3 ports                             | `2b9773a` (canon) + `4ac86cc` (move)                      |
| S3.4      | `GatewayBillingService` → `@core/application/billing/` + 9 ports + UoW + logger swap    | `29d8a17` + `df6536c` + `f26f6b1` + `91df5d5` + `f9e9a8d` |
| S4.1      | Compliance cluster (`ComplianceService` + `DataRetentionService`) + 6 ports             | `ce570b2` (canon) + `62b23bd` (move)                      |
| S4.2      | `DlqArchivalService` → `@core/application/webhooks/` + 1 port                           | `cad9408`                                                 |
| S4.3      | `AiRequestService` → `@core/application/ai/` + AI contracts promotion (ADR-0010)        | `262faaf`                                                 |
| S4.4      | `RoleManagementService` → `@core/application/auth/` + `Permission` promotion (ADR-0009) | `ee8d4a0`                                                 |
| S5        | Burn-down of `Permission` + `GatewayAdapterRegistryPort` shims + fitness `#22`          | `1734890`                                                 |

### Outcome

- **9 services** relocated to `packages/core/application/{billing,
security,settings,compliance,webhooks,ai,auth}/`.
- **~30 new ports** in `packages/core/domain/repositories/`.
- **~25 new Prisma adapters** in `apps/api/src/infrastructure/
repositories/`.
- **Permission enum** + **AI contracts** promoted to `@core/domain`
  (ADR-0009, ADR-0010).
- **Fitness `#22`** added: `grep -rlE "^\s*\*\s*@layer
application\s*$" apps/api/src --include="*.ts"` hard-zero in CI.
- **22 fitness functions total** (ADR-0012), depcruise hard-zero,
  220+ tests passing, zero `prisma.*` calls in `@core/application/`.

## Rationale

1. **Cross-deployable reuse delivered.** `apps/workers` resolves the
   same use case from its own composition root as `apps/api`. Zero
   duplication.
2. **Each service is testable without booting Prisma.** Unit tests
   mock the 3-9 ports per service; integration tests run against a
   test DB.
3. **`UnitOfWork` adoption universal in mutating services** (ADR-
   0005). `GatewayBillingService`'s 6 `$transaction([...])` arrays
   became `unitOfWork.executeInTransaction(async () => { ... })`
   closures with proper port calls.
4. **Audit pattern unified via `AuditEmitterPort`** (introduced in
   S1' canon). Every service emits audit events through the port,
   not direct `prisma.auditLog.create()`.
5. **CI guardrail prevents regression.** Fitness `#22` makes the
   migration durable — any future attempt to add a `@layer
application` file in `apps/api/src/` fails the CI gate.

## Alternatives Considered

- **Defer relocation; keep services in `apps/api`.** Considered
  before S0. Rejected: blocks cross-deployable reuse, blocks
  apps/workers from being a real deployment option, makes apps/api
  the only execution surface for business logic.
- **Use a single big-bang commit for all 9 services.** Rejected:
  too risky for review + bisect; chose the 13-commit phased
  approach with canon-refactor → move pairs (some merged when
  small).
- **Skip the shim burn-down (S5) and accept long-term shims.**
  Rejected: shims add cognitive overhead ("which path do I import
  from?") and CI fitness `#22` couldn't be hard-zero with shims
  active. S5 closed the loop.
- **Refactor `RbacService` itself to `@core/application/`.**
  Out of scope. `RbacService` has Fastify-adjacent wiring (request-
  context-aware checks, CachePort namespace, audit helper) that
  doesn't belong in framework-free application layer. Decision:
  re-label as `@layer infrastructure`, promote only the
  `Permission` enum (ADR-0009).

## Consequences

**Positive**

- The `@core/application/` package is the canonical home for
  business logic; the structure is enforceable by CI.
- Application services depend only on ports + `Result` +
  `UseCaseError` + `UnitOfWork` — no infrastructure leakage.
- Future delivery mechanisms (CLI, MCP, additional workers) get
  cross-deployable use cases for free.
- ADRs 0002-0008 (foundational decisions) + 0009-0011 (S1'→S5
  specifics) + 0012-0013 (operational) document the rationale.

**Negative / costs**

- ~30 new port + adapter pairs increase the file count significantly
  in `packages/core/domain/repositories/` and
  `apps/api/src/infrastructure/repositories/`.
- Onboarding to "where is X?" requires knowing the
  domain/application/infrastructure split — partially mitigated by
  the structure being mechanical (port name → adapter name → use
  case name).
- The workstream consumed 22 commits + ~2 weeks of architectural
  work that did not ship customer-facing features. The
  justification: every feature shipped after S5 closes more
  cheaply.

## Revisit if

If we discover that 2+ contexts in `@core/application/` need to
diverge into independent deployables (e.g., billing becomes a
separate service), we revisit by splitting `@core/application/
<context>/` into separate packages (`packages/billing-application`,
`packages/compliance-application`, etc.). The Normalization Roadmap
§0.2 + §5.1 already track this as a deferred refactor with
explicit trigger events.

## Risks and Mitigations

| Risk                                                     | Mitigation                                                                                                                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New `@layer application` file appears in `apps/api/src/` | Fitness `#22 No @layer application in apps/api/src` hard-zero CI gate.                                                                                                                    |
| Future code review accepts inverted-dependency imports   | Depcruise rules `core-application-no-infrastructure` block at PR time.                                                                                                                    |
| Port surface grows inconsistent across services          | Two emerging patterns: (a) low-level port (e.g., `PlatformCredentialRepository` raw envelope storage), (b) port-as-service-port (e.g., `EmailPort`). Code review picks the right pattern. |
| `@core/application/` becomes a monolith blob             | Bounded contexts are kept as sub-folders. If 2+ contexts have zero cross-imports, ROADMAP §5.1 triggers a split into separate packages.                                                   |
| Cross-context port re-use without proper boundary        | Each context owns its ports under `@core/domain/repositories/`. Ports shared across contexts (e.g., `AuditEmitterPort`, `EmailPort`) are explicitly cross-cutting.                        |

## References

- 22 commits of the workstream: `git log workstream/application-services-to-core ^main` (now merged to main, ending at `1734890`)
- OmniPost `docs/architecture/APPLICATION_SERVICES_TO_CORE_ROADMAP_ES.md` — workstream roadmap with phase breakdown
- OmniPost `docs/architecture/NORMALIZATION_ROADMAP.md` — successor doc capturing post-closure improvements
- ADR-0002 — Hexagonal Architecture (the macro pattern this workstream realized)
- ADR-0005 — Unit of Work (concrete adoption in S3.4c)
- ADR-0009 — Permission enum promotion (S4.4)
- ADR-0010 — AI contracts promotion (S4.3)
- ADR-0012 — Fitness functions (`#22` introduced in S5)
