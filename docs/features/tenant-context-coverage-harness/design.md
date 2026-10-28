# Design: Tenant-Context Runtime Coverage Harness

## Technical Approach

A node:test integration suite boots the REAL app via the exported `createApp()` (`apps/api/src/index.ts:174`; guarded client wired by `setupContainer` → `tenantGuardExtension`, `container/setup.ts:62`), drives every HTTP entry point per auth-binder tier, and observes `TenantContextMissingError` (`code = "TENANT_CONTEXT_MISSING"`, `tenantGuard.ts:46`) at the guard. Output: machine-readable blast radius + committed allowlist ratchet. Observation only — no seam is fixed.

**Position in the layered net (ADR-0020 §Consequences).** This harness is ONE layer — the **empirical HTTP-typed layer** — of the four-layer net. It is NOT the completeness oracle. The oracle is the **static leaf-census** (registryReconcile), which alone sees raw SQL, `start()`-only background surfaces, and undriveable paths; fitness #23 covers raw-query discipline; the ratchet (D6) tightens across all layers. Stated plainly: **guard-observation coverage == typed-query coverage** — the `$extends` guard hooks only Prisma's typed query API, so `$queryRaw`/`$executeRaw` NEVER publish. The harness is structurally blind to raw SQL and this design never claims otherwise (the prior static check #29 over-claimed and was gate-flagged; not repeated).

## Architecture Decisions

### D1: Observation = `diagnostics_channel` publish + probe-token correlation

**Choice**: `tenantGuard.ts` publishes `{model, operation, probeToken}` on `omnipost.tenant-guard.context-missing` immediately before throwing. `probeToken` is read from a probe-correlation `AsyncLocalStorage` exported by the guard module (separate from `TenantContext` — the probe is context-less by definition; unbound in production → field absent, still a no-op with zero subscribers). The harness wraps each probe in `probeCorrelation.run(uniqueToken, ...)` and matches events **by token equality, never temporal sequencing**, draining pending async work between probes. Tokenless or stale-token events are recorded `unattributed` and fail reconciliation — never silently attributed.
**Alternatives**: Fastify `onError` (swallowed by Result/UoW try-catch); response-body matching (genericized); sequential-order attribution — rejected: detached async work mis-attributes across probes.
**Rationale**: one instrumentation point covers all drive mechanisms; the token makes attribution exact.

### D2: Route enumeration via optional `onRoute` observer on `createApp(options?)`

Installed before any registration; captures `{method, url, preHandler[]}`; preHandler `.name` → binder tier (`requireAdminAuth` → admin; customer → client; integration → integration; none → pre-auth). Unknown names FAIL reconciliation. No-op when absent.

### D3: Drive mechanism per class

| Class                                                                                                                      | Enumeration                   | Drive                                                                              | Observe                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- |
| HTTP routes                                                                                                                | onRoute (D2)                  | `app.inject` per tier + `none` tier; minimal valid bodies from route schemas (D5a) | token-matched events + status                   |
| Consumers with exported wiring (`bulkScheduleWorker.ts:163`, `inboxSyncConsumer.ts:124`, `analyticsIngestConsumer.ts:124`) | `QUEUE_NAMES` vs wiring sites | test Redis + one probe job                                                         | token events + `failedReason`                   |
| Scheduler tasks registered during `createApp`                                                                              | existing `getActiveTasks()`   | new `runTaskOnce(taskId)` (scheduler retains the callback)                         | events + returned error                         |
| `start()` background surfaces                                                                                              | static census (D9)            | **static-only by declaration** (D9)                                                | census oracle; tag `static-only`                |
| Raw-bypass surfaces                                                                                                        | static raw census (D8)        | **not probed**                                                                     | tags `excluded-raw-bypass` / `raw-unobservable` |
| Bootstrap constructors                                                                                                     | leaf census                   | not drivable                                                                       | census oracle                                   |

### D4: Honesty tiers — record reach depth, never over-claim

`reach: handler | binder | validation-only | auth-rejected | raw-unobservable | static-only | excluded-raw-bypass`.

- **Green rule**: `contextMissing: false` is claimable ONLY at `reach: handler|binder` AND when the driven path's enrolled-model access is via the TYPED API (surface not in D8's raw blind set). A raw-only path is `raw-unobservable` and NEVER green.
- **`auth-rejected`**: a 401/403 probe never records `contextMissing: false`; on a tier with seeded fixtures it also fails reconciliation (fixture drift would silently darken the whole tier).
- **`validation-only`** is a false-green channel over mutating admin/integration routes (Fastify runs Zod BEFORE `preHandler`): never green. In-slice mitigation: D5a valid-body fixtures; routes where no valid body is derivable remain `validation-only`, are covered by the static census oracle, and the report declares them as such.

### D5: Binder fixtures / D5a: valid-body fixtures

Client: `signCustomerAccessToken` (`auth/customerJwt.ts`). Admin: seeded AdminUser + AdminSession + `admin-session` cookie. Integration: seeded `integrationApiKey` + `X-API-Key` (the binder itself queries an enrolled model context-less — expected blast radius). Helper: `binderFixtures.ts`. **D5a**: best-effort minimal valid-body generation from the route's JSON schema (swagger) for mutating routes; failure to derive = honest `validation-only`, not a skipped assertion.

### D6: Two-way allowlist ratchet across ALL layers, no global mode flip

`expected-context-missing.json` = initial blast radius **including census entries** (raw sites, `start()` surfaces). Fail on: (a) non-allowlisted runtime throw, (b) NEW census entry (new raw query on tenant tables / new unseamed `start()` registration), (c) stale entry. `TENANT_COVERAGE_MODE=report` is local-only; CI always ratchets. Rejected: report-mode-in-CI (report-mode-forever trap).

### D7: Output format

```jsonc
{
  "generatedAt": "...",
  "surfaces": [
    {
      "class": "http|consumer|scheduler|saga|bootstrap",
      "id": "GET /api/v1/...",
      "binder": "admin|client|integration|none",
      "reach": "handler|binder|validation-only|auth-rejected|raw-unobservable|static-only|excluded-raw-bypass",
      "contextMissing": true,
      "events": [{ "model": "...", "operation": "...", "probeToken": "..." }],
    },
  ],
  "unattributedEvents": [],
}
```

Written to `blast-radius.report.json`; committed snapshot at `docs/security/TENANT_CONTEXT_BLAST_RADIUS.md` documents per-layer honesty (empirical layer vs census oracle).

### D8: Raw-SQL blindness is a structural limit — census + tiers, never probes

**Choice**: registryReconcile adds a static `$queryRaw`/`$executeRaw` census over sites touching `TENANT_SCOPED_MODELS` tables. A handler-reach probe with zero events is cross-checked against it: if the route's driven path includes a raw-census module → `raw-unobservable`. `excluded-raw-bypass` broadens beyond saga/workers to every in-process route-reachable raw surface on enrolled models: `PrismaGlossaryRepository`, `PrismaStyleGuideRuleRepository` (glossary/styleGuideRule), `PrismaSemanticRetrievalAdapter`, `EventStore`, `DatabaseOptimizer`, `OutboxClaimService`, `PrismaUnitOfWork`, `SagaManagerLifecycle`, and the in-process raw saga (`EventService` built with the raw singleton, `index.ts:634`).
**Alternatives**: probing these paths anyway — rejected: the guard never fires on raw SQL, so the probe records a false GREEN.
**Rationale**: only the census (+ fitness #23's audited allowlist) covers raw; the harness must tag, not claim.

### D9: `start()` background surfaces are static-only BY DECLARATION; the census is their completeness oracle

The 9 `scheduler.register` calls (`index.ts:834–965`), the 4 inline consumers (`index.ts:989–1042`), and the 4 previously-missed class-internal registrations — outboxRelay→`integrationSubscription` (`:795`), BulkScheduleReconciliation→`bulkScheduleBatch` (`:799`), GatewaySwitchProcessor→`gatewaySwitchEvent` (`:807`), recurrenceScheduler→`recurringPost` (`:821`) — live in `start()`, NOT `createApp()`: enumerable but never driven. Slice 6.0 therefore **empirically covers ~HTTP only**, and says so.
**Choice (b)**: declare them `static-only` honestly; the STATIC leaf-census — extended to catch class-internal registrations and raw BullMQ `Worker` constructions, not just `scheduler.register(` greps — is their completeness oracle and their ratchet entry.
**Alternative (a) rejected for 6.0**: booting/triggering `start()`'s ticks+consumers requires either running the production bootstrap under test (live relays/ticks with side effects racing probe-token isolation) or extracting registrations behind injectable seams — and that seam extraction IS the later remediation slices' work; this slice observes only (proposal constraint). Post-seam slices move each surface into the drivable layer via `runTaskOnce`/probe jobs, shrinking `static-only`.

## Data Flow

    probe: probeCorrelation.run(token) { inject | enqueue | runTaskOnce } → drain async work
        → boundary binder → handler → guarded Prisma client (TYPED API only)
        → tenantGuard: no context → publish({model, operation, probeToken}) → throw
    harness ← channel → match by token → report + ratchet assert
    registryReconcile (ORACLE): leaf census + raw census + start()/class-internal/Worker census → same ratchet

## File Changes

| File                                                                     | Action | Description                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/tests/integration/tenantContextCoverage/routeCoverage.test.ts` | Create | HTTP: enumerate, classify, drive per tier; D5a valid-body fixtures                                                                                                                                                               |
| `.../consumerCoverage.test.ts`                                           | Create | Drivable consumers via probe jobs                                                                                                                                                                                                |
| `.../schedulerCoverage.test.ts`                                          | Create | `getActiveTasks()` + `runTaskOnce` probes (expected empty in 6.0 — all registrations live in `start()`; kept as the post-seam drive path)                                                                                        |
| `.../registryReconcile.test.ts`                                          | Create | onRoute vs route-file grep; QUEUE_NAMES vs wiring; `scheduler.register(` + class-internal registrations + raw BullMQ `Worker`s; leaf census (57 `TENANT_SCOPED_MODELS` accessors); **raw `$queryRaw`/`$executeRaw` census (D8)** |
| `.../binderFixtures.ts`, `.../observe.ts`                                | Create | Tier credentials; token-matched channel subscriber; drain helper; report writer                                                                                                                                                  |
| `.../expected-context-missing.json`                                      | Create | Initial allowlist incl. census entries (ratchet)                                                                                                                                                                                 |
| `infra/prisma/src/extensions/tenantGuard.ts`                             | Modify | Publish before throw + probe-correlation ALS (no-op unobserved)                                                                                                                                                                  |
| `apps/api/src/index.ts`                                                  | Modify | `createApp(options?)` onRoute observer (no-op default)                                                                                                                                                                           |
| `packages/observability/background-scheduler/src/default-scheduler.ts`   | Modify | Retain callback reference; add `runTaskOnce(taskId)`; enumeration reuses existing `getActiveTasks()`                                                                                                                             |
| `docs/security/TENANT_CONTEXT_BLAST_RADIUS.md`                           | Create | Committed snapshot with per-layer honesty declaration                                                                                                                                                                            |

## Testing Strategy

| Layer                   | What                                                                                                                  | Approach                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Unit (vitest)           | guard publish + token payload, tier classifier, token matcher (walks `error.cause`), raw-census parser, `runTaskOnce` | RED first (strict TDD)                                                                  |
| Integration (node:test) | the harness itself                                                                                                    | real DB + Redis (`pnpm db:up`); LXC-safe: single files, `--max-old-space-size`, timeout |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary is changed; the three production touches are unobserved no-ops.

## Migration / Rollout

No migration. Ratchet staging: initial allowlist = full blast radius including census entries; remediation slices delete entries (or move `static-only`/`raw-unobservable` surfaces into the drivable layer); empty allowlist = permanent regression net.

## Open Questions

- [ ] AdminSession seeding shape (token hashing) — pin exact fields at task time from `PrismaAdminSessionRepository`.
- [ ] `integrationApiKey` hash scheme for the fixture key — pin at task time.
- [ ] Exact drain primitive between probes (microtask flush vs queue-idle await) — pin at task time against the outbox/queue test helpers.
