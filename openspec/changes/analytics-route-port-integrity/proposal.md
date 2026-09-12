# Proposal: analytics-route-port-integrity (SMELL-98)

> Materialized from Engram `sdd/analytics-route-port-integrity/proposal` (obs 681).

## Intent

`AnalyticsRouteHandler` (`apps/api/src/analytics/analyticsRoutes.ts`) takes `PrismaClient` as ctor param 1 next to `ProjectQueryRepositoryPort` and runs 10 direct `this.prisma.*` reads across 3 handlers — the paradox anti-pattern (ARCHITECTURE_CANON §DI: "a class that already receives a port must USE that port") plus "routes resolve use cases only, never Prisma". Fitness #1/#21 grep the singleton import and are blind to the injected-type form, so the canon rule is ungated here. This change restores it via **Approach A: port-only swap, zero OBSERVABLE behaviour change** (signed). Honest nuance: security POSTURE quietly improves (the analytics scoping step gains tenant-guard layer-1 coverage) — equivalence claimed only for responses.

## Scope

| Trabajo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Qué arregla                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Sites #1/#9 → `ProjectQueryRepositoryPort.countPosts(projectId)` — EXACT reuse                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 2 raw counts leave the route                                                                                                         |
| Site #4 → `ProjectQueryRepositoryPort.findById(projectId)` — EXACT reuse; ported, NOT deleted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | raw project read leaves; redundant round-trip noted in SMELL-101                                                                     |
| NEW `ProjectQueryRepositoryPort.listChannelRefsByProject(projectId)`, explicit `select {id, provider, handle}` — sites #2/#6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | R1: the wide no-select `getChannelsByProject` is BANNED in this file; the export spread (:783-786) can never ship credential columns |
| NEW `ProjectQueryRepositoryPort.listPostExportRows(projectId, take)`, 5-field select, createdAt desc, take 1000 — site #5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | R4: preserves the export's exact post shape; avoids `PostQueryRepository.listByProject` over-engineering                             |
| NEW `ThreadReadRepository.listThreadRefsByProject(projectId, take)`, select {id, postId, strategy, createdAt}, take 1000 — site #8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | R3: existing `getByProjectId` drops `take` and inflates with tweet bodies                                                            |
| NEW `AnalyticsReadRepository.listProjectEntries(projectId, {since?, take})`, single nested-join byte-equivalent to today's query — sites #3/#7/#10 (R2 decision below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | keeps today's rows AND query plan; drops #3's dead `include post.id` (invisible — handler reads `e.postId`)                          |
| Ctor/DI: drop `PrismaClient` (param 1), inject `AnalyticsReadRepository` + `ThreadReadRepository` (tokens already registered at `types.ts:49-50`, `setupRepositories.ts`); update plugin registration (:977) + remove the `type PrismaClient` import                                                                                                                                                                                                                                                                                                                                                                                                                                                            | the canon violation itself                                                                                                           |
| Characterization tests (NEW — R5: the declared net does not exist): pin response SHAPE for getDashboard / exportAnalytics (json+csv) / getProjectAnalytics; Strict TDD — proven able to fail, green pre-swap, byte-identical post-swap; unique cache key per request (R8)                                                                                                                                                                                                                                                                                                                                                                                                                                       | the only real net; shape-only so the filed double-count is never enshrined as expected output                                        |
| Backlog filings (docs rows in `docs/reports/roadmap-detected-smells-backlog.md`): **SMELL-99** wide `getChannelsByProject` adapter (no `select` + `as unknown as ChannelDto[]` cast) + phantom `ChannelDto.credentials` field drifted from schema; **SMELL-100** `analyticsRoutes.test.ts` imports the ADMIN same-basename file — test-subject mismatch, a different class from 99, so its own row; **SMELL-101** the R9 quartet (per-channel double-count, take-truncation labelled as totals, CSV permanently-blank columns, fake-zero fields) + site #4's redundant re-read — promotion path: their own future change (Approach C direction) needing product input on what the dashboard numbers should mean | debt named and owned, not absorbed                                                                                                   |

### R2 decision (made here)

Reusing `AnalyticsReadRepository.getByProjectId` would return identical bytes but swaps one nested join for a two-step with an UNBOUNDED post-id materialization on the dashboard hot path. "Measure" has no budget in a residue cleanup, so this proposal adds the bounded single-query method on the EXISTING port (no fifth analytics port): rows AND cost stay identical. Budget impact: CODE ~150-205 (was ~135-185; hard 400 untouched).

## Non-Goals (explicit)

- R9 defects FILED (SMELL-101), not fixed — fixing them breaks the zero-behaviour frame and needs product sign-off.
- Wide-adapter + phantom-DTO fix FILED (SMELL-99) — its consumers and DTO shape are another change's scope.
- Site #4 deletion deferred — would widen the 11-caller `getProjectAccess`.
- NO new fitness gate for "routes never receive PrismaClient" — needs a tokened workflow edit; candidate for the next fitness-touching slice.
- No fifth analytics port; no edits in `packages/adapters/db-prisma` (#38 ratchet, SMELL-87); no schema/migration; 501 stubs, ROI/cross-platform/thread/SSE handlers untouched; no CQRS extraction — Approach B is the named successor AFTER SMELL-101 lands.

## Capabilities

- New Capabilities: None. Modified Capabilities: None — pure refactor, no spec-level behaviour change. sdd-spec should express the preservation invariants (response shapes byte-identical, ctor ports-only) as scenarios.

## Approach

Port-only swap: 2 exact reuses + 4 new narrow methods on 3 existing ports. Adapters live in `apps/api/src` (`PrismaProjectQueryRepository`, `PrismaThreadReadRepository`, `PrismaAnalyticsReadRepository`) with `deletedAt: null` INLINE in each call's own `where` (fitness #38 +9 window — no hoisted builder seed, R6). New methods adopt `ProjectQueryRepositoryPort`'s plain-string convention (matches the route's injected port; TenantScope VOs built inside a route are the over-engineering explore rejected) — R7; branch from main (orchestrator correction: NOT the tenant-isolation tip — a stale note; the plain-string convention choice stands on its own). Single PR, tokenless, Strict TDD (characterization first).

## Affected Areas

| Area                                                                             | Impact                                                            |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `apps/api/src/analytics/analyticsRoutes.ts`                                      | Modified — 10 sites rewired, ctor reshaped, prisma import removed |
| Read ports (`packages/core/domain/src/repositories/` — Project/Thread/Analytics) | Modified — 4 narrow method signatures                             |
| `apps/api/src` Prisma read adapters (Project/Thread/Analytics)                   | Modified — 4 narrow implementations                               |
| DI plugin/container wiring for the analytics route                               | Modified — resolve 2 more ports, drop PrismaClient                |
| `apps/api/tests/unit/` characterization + adapter tests                          | New                                                               |
| `docs/reports/roadmap-detected-smells-backlog.md`                                | Modified — close 98, add 99/100/101                               |

## Risks (R1-R9 dispositions)

| Risk                                                                            | Disposition                                                                                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| R1 HIGH — credential leak if wide channel method reused under the export spread | Mandated narrow select-bearing method; wide method banned in this file; hazard filed SMELL-99. SECURITY_CANON admits no marker |
| R2 MED — two-step query-plan divergence                                         | Resolved: bounded single-join method (decision above)                                                                          |
| R3 MED — thread include/take drift                                              | New narrow thread method                                                                                                       |
| R4 MED — PostDto shape drift                                                    | New narrow post method, 5-field select preserved                                                                               |
| R5 MED — declared test net is fiction                                           | Characterization suite is new work, shape-only; bulk of EVIDENCE budget                                                        |
| R6 LOW-MED — fitness #38                                                        | `deletedAt: null` inline per call; stay out of db-prisma                                                                       |
| R7 LOW — two port conventions live                                              | Plain-string convention chosen and justified                                                                                   |
| R8 LOW — 5-min HTTP cache masks regressions                                     | Unique projectId/timeRange per characterization request                                                                        |
| R9 — four live defects in moved code                                            | Filed SMELL-101; tests pin shape, never arithmetic                                                                             |

## Rollback Plan

Single `git revert` of the PR merge commit — pure refactor: no schema, no migration, no config, no data movement. Characterization tests are additive and survive the revert harmlessly.

## Dependencies

None external. Tokens for all three ports already declared and registered.

## Success Criteria

- [ ] Zero `prisma` references in `analyticsRoutes.ts`; ctor is ports-only; plugin/container updated.
- [ ] All 10 call sites served by ports (2 exact reuses, 4 new narrow methods); no `getChannelsByProject` call in this file.
- [ ] Characterization suite proven able to fail, green pre-swap, responses byte-identical post-swap for the 3 handlers.
- [ ] Gate 0/0: lint, tsc, full fitness suite (incl. #38 hard-zero; db-prisma ratchet untouched at ≤11).
- [ ] SMELL-98 closed; SMELL-99/100/101 rows added with owners and promotion paths.
- [ ] CODE ≤205 (hard 400); EVIDENCE ~400-550, declared once; single PR.

## Debatable point (stated openly)

The 4th analytics method. `getByProjectId` already returns identical bytes — `listProjectEntries` exists solely to preserve the query PLAN (avoid unbounded post-id materialization on a hot, cached path). A reviewer preferring zero new analytics surface at unmeasured cost can drop it and reuse `getByProjectId`; the proposal chose plan-preservation because "zero behaviour change" was signed without a measurement budget, and an unmeasured plan swap is a behaviour bet, not a behaviour proof.
