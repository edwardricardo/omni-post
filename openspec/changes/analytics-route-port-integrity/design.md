# Design: analytics-route-port-integrity (SMELL-98)

> Materialized from Engram `sdd/analytics-route-port-integrity/design` (obs 683). The
> design-gate verdict (obs 684, PASS-with-findings) rode its corrections into tasks.md
> rather than back into this document; where they conflict, tasks.md governs (notably: the
> Layer-B snapshot mechanism was corrected to raw-string goldens, the mock needs four
> store-backed models added in-suite, and the backlog row arrives via PR #247's merge).

## Technical Approach

Approach A (signed): port-only swap. 2 exact reuses (`countPosts`, `findById`) + 4 new narrow methods on 3 EXISTING ports; `AnalyticsRouteHandler` ctor loses `PrismaClient`; aggregation stays in the route. Strict TDD: characterization first. Approach B (CQRS query extraction to `packages/core/analytics`) is the named successor, out of scope until SMELL-101 lands. Every anchor below verified against the tree 2026-09-12.

## Decision 1 — Port signatures (exact TS)

New DTOs live in the PORT FILES (not `ReadModelDtos.ts` — `ChannelDto`/`ThreadDto` stay untouched; SMELL-99 stays filed). Plain-string params: `ProjectQueryRepositoryPort`'s own convention (`countPosts(projectId: string)` :82), the port the route already injects. JSDoc per canon.

`packages/core/domain/src/repositories/ProjectQueryRepository.ts`:

```typescript
/** Channel reference — the ONLY channel projection analytics responses may embed.
 *  Credential columns are stripped at the query, never post-hoc. */
export interface ChannelRefDto { id: string; provider: ProviderKind; handle: string; }
/** Export row for a post: the five columns the analytics export exposes. */
export interface PostExportRowDto {
  id: string; status: string; scheduledAt: Date | null;
  publishedAt: Date | null; createdAt: Date;
}
// on ProjectQueryRepositoryPort:
listChannelRefsByProject(projectId: string): Promise<ChannelRefDto[]>;
listPostExportRows(projectId: string, take: number): Promise<PostExportRowDto[]>;
```

`ThreadReadRepository.ts`:

```typescript
/** Thread reference row. NOTE: unordered take by contract — callers get the
 *  storage order the database yields; determinism is not promised. */
export interface ThreadRefDto { id: string; postId: string; strategy: string; createdAt: Date; }
// on ThreadReadRepositoryPort:
listThreadRefsByProject(projectId: string, take: number): Promise<ThreadRefDto[]>;
```

`AnalyticsReadRepository.ts`:

```typescript
export interface ProjectEntriesOptions { since?: Date; take: number; }
/** Bounded single-join read of a project's analytics entries, capturedAt desc.
 *  Exists beside getByProjectId because that one materializes an unbounded
 *  post-id list in a two-step; this preserves the single nested-join plan. */
listProjectEntries(projectId: string, options: ProjectEntriesOptions): Promise<AnalyticsDto[]>;
```

`AnalyticsDto` (ReadModelDtos:257-267) is EXACTLY the Analytics table's 9 columns, so a full-row return is column-identical to site #7's explicit 9-field select.

## Decision 2 — Adapter implementations (byte-equivalent Prisma shapes)

All in `apps/api/src/infrastructure/repositories/`, `deletedAt: null` INLINE in each call's own `where` (fitness #38 call+9 window; no hoisted builder — R6). Enum casts follow the files' existing `as unknown as` runtime-identity convention.

`PrismaProjectQueryRepository`:

```typescript
async listChannelRefsByProject(projectId: string): Promise<ChannelRefDto[]> {
  const rows = await this.prisma.channel.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true, provider: true, handle: true },
  });
  return rows as unknown as ChannelRefDto[];
} // == route :576-579 / :729-732

async listPostExportRows(projectId: string, take: number): Promise<PostExportRowDto[]> {
  return this.prisma.post.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true, status: true, scheduledAt: true, publishedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take,
  });
} // == route :716-727 (route passes 1000)
```

`PrismaThreadReadRepository`:

```typescript
async listThreadRefsByProject(projectId: string, take: number): Promise<ThreadRefDto[]> {
  return this.prisma.thread.findMany({
    where: { post: { projectId, deletedAt: null } },
    select: { id: true, postId: true, strategy: true, createdAt: true },
    take,
  });
} // == route :755-764 — deliberately NO orderBy (today has none; adding one is a behaviour change)
```

`PrismaAnalyticsReadRepository`:

```typescript
async listProjectEntries(projectId: string, options: ProjectEntriesOptions): Promise<AnalyticsDto[]> {
  const rows = await this.prisma.analytics.findMany({
    where: {
      post: { projectId, deletedAt: null },
      ...(options.since !== undefined && { capturedAt: { gte: options.since } }),
    },
    orderBy: { capturedAt: "desc" },
    take: options.take,
  });
  return rows as unknown as AnalyticsDto[];
} // serves #3 (since+take 500), #7 (since+take 5000), #10 (no since, take 100)
```

**One deliberate delta**: site #3's `include: { post: { select: { id: true } } }` (:585-587) is DROPPED. Observationally invisible: the handler reads `e.postId` (:622), never `entry.post`; no response field derives from the include, so pre/post bodies are byte-identical. Site #7's explicit select vs full row: same 9 columns either way. (Post-verify note: an explicit nine-field select was RESTORED on this method per gate finding W1, so the export's key set never couples to future `Analytics` columns.)
`exactOptionalPropertyTypes`: the conditional spread on `since` is mandatory — never `capturedAt: undefined`.
#38 posture: channel/post calls carry inline `deletedAt` in-window; analytics/thread nested predicates remain #38-invisible (documented residual 4) exactly as today — unchanged, not worsened.

## Decision 3 — Ctor / DI rewiring

New ctor (drop param 1; two ports inserted after `projectRepository`):

```typescript
constructor(
  private readonly threadAnalytics: ThreadAnalytics,
  private readonly projectRepository: ProjectQueryRepositoryPort,
  private readonly analyticsRepository: AnalyticsReadRepositoryPort,
  private readonly threadRepository: ThreadReadRepositoryPort,
  private readonly broadcaster: AnalyticsStreamBroadcaster,
  private readonly scheduler: BackgroundTaskScheduler,
  private readonly realtimeService: RealtimeAnalyticsService,
  private readonly calculateROIUseCase: CalculateROIUseCase,
  private readonly getCrossPlatformAnalyticsUseCase: GetCrossPlatformAnalyticsUseCase,
  private readonly streamTracker: StreamConnectionTracker
) { super(); }
```

Plugin (:976-1013): delete the `TOKENS.PrismaClient` resolve (:977); add `container.resolve<AnalyticsReadRepositoryPort>(TOKENS.AnalyticsReadRepository)` and `container.resolve<ThreadReadRepositoryPort>(TOKENS.ThreadReadRepository)`; update the `new AnalyticsRouteHandler(...)` arg list; delete `import type { PrismaClient } from "@infra/prisma"` (:18); add the two port type imports; fix the stale plugin JSDoc (:972-975 still names GeoAnalyticsService + PrismaClient). ZERO container additions: tokens exist (`types.ts:48-50`) and all three adapters are registered singletons (`setupRepositories.ts:155-171`).

## Decision 4 — Characterization test design

**Harness**: `app.inject` through the REAL plugin + REAL `setupContainer(mockPrisma)` (precedent `projectRoutes.test.ts:241-250`), mocked `requireClientAuth` binding a fixed principal (precedent :20-42). NOT handler-direct: the ctor arity changes mid-PR; via the plugin, the suite text is byte-identical pre and post.
**Harness invariant** (as corrected by gate W2): identical RESULTS under the mock — two sites legitimately change call shape (the dead-include drop, W1's restored select).
**Mock gap** (as corrected by gate C1): `helpers/mockPrisma.ts` lacks the `post`/`channel`/`analytics`/`thread` models entirely (11 stores, no Proxy catch-all) — the suite bolts on four store-backed models via `buildModelMock(createStore())` (precedent `projectRoutes.test.ts:108-152`, named-one-by-one rule) plus the two semantic patches (nested-relation `where`; scalar `select` projection). Patches implement Prisma SEMANTICS, never expected outputs; the same patch answers both sides.
**File**: `apps/api/tests/unit/analytics/analyticsRoutes.characterization.test.ts` — new subdirectory sidesteps the SMELL-100 same-basename trap; imports the customer routes file.
**Fixtures**: fixed-date seeds; 2 channels on ONE provider + 1 on another (exercises grouping); analytics rows incl. `postId: null`; soft-deleted rows that must not surface; `capturedAt` values inside/outside the 7d window.
**SHAPE-only rule, mechanical**: assertions MAY touch HTTP status, content-type, deep sorted key-sets, `typeof`/`Array.isArray`, array lengths tied to seeded ENTITY counts, identity passthroughs, the exact CSV header row. Assertions MUST NOT touch any value produced by arithmetic over analytics rows: sums, rates, row counts, `topPlatform`, `summary.*`, `performanceScore`.
**Byte-identity protocol** (as corrected by gate C2): Layer A = committed shape assertions (permanent). Layer B = raw `res.body` STRING snapshots after deterministic regex normalization of `exportedAt` — goldens authored pre-swap, the swap passes them UNCHANGED (no `-u`), the PR's final work unit deletes the layer. (Execution note: the goldens proved `.gitignore`d, so the shipped proof is the recorded sha256 pair plus the verify gate's independent structural re-establishment — see verify-report.)
**Proven able to fail**: planted response-builder mutations (rename `dataPoints` :666, rename a CSV header :808-810, drop `postCount` :957) → REAL non-zero exits, byte-exact restores, re-run green.
**R8 cache**: the unit app never registers `autoCacheMiddleware` (global, not in the route plugin) — structurally absent; unique projectId/timeRange keys anyway.

## Decision 5 — Credential-projection proof (spec invariant 3)

Adapter unit test on `listChannelRefsByProject`: seed mock channel rows CARRYING `credentialsCiphertext/Iv/AuthTag/KeyVersion` (real columns, schema.prisma:839-842). Assert BOTH: (a) **call-args pin — the load-bearing proof (gate W4: extended to ALL FOUR new methods)** — the adapter passed exactly `select: {id, provider, handle}` and no `include`; (b) returned key-set === `["handle","id","provider"]` (labelled honestly: (b) proves the patch, not the adapter). Belt-and-braces: one characterization assertion that export `channels[]` elements contain no `credential*` key.

## Decision 6 — Ordering / work units (single PR, branch from MAIN)

Branch off `main` (fdda5d25 or current descendant) — NOT `workstream/tenant-isolation` (stale proposal note).

1. Characterization suite + Layer-B goldens (RED = planted-mutation demonstrations, then green on the untouched tree).
2. Ports + adapters + adapter unit tests incl. credential proof (additive; adapter tests written first).
3. The swap: 10 sites → port calls, ctor/plugin/import rewire; suite AND goldens pass untouched.
4. Golden-layer deletion + backlog rows (close SMELL-98; add SMELL-99/100/101 — arrives via PR #247's merge, gate C3) + stale JSDoc fix.

Forecast (two-tier): CODE ~150-205 incl. canon JSDoc — hard 400 safe. EVIDENCE ~520-670 as re-forecast by the gate (W6), hard writer stop 770.

## Decision 7 — Risk dispositions (design-level)

| Risk                    | Disposition here                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 HIGH credential leak | D1/D5: narrow select-bearing method is the only channel read; wide `getChannelsByProject` banned in this file; proof test pins the projection. No marker possible (SECURITY_CANON) |
| R2 plan divergence      | D1/D2: `listProjectEntries` single nested-join, bounded — plan preserved, not re-measured                                                                                          |
| R3 thread drift         | D1/D2: `listThreadRefsByProject` keeps 4-field select + take, no include, no orderBy                                                                                               |
| R4 post shape drift     | D1/D2: `PostExportRowDto` 5 fields, createdAt desc, take preserved                                                                                                                 |
| R5 fictional net        | D4: suite is new work, app.inject, real container over the extended mock                                                                                                           |
| R6 fitness #38          | D2: inline `deletedAt` per call; zero edits in `packages/adapters/db-prisma`                                                                                                       |
| R7 convention split     | D1 + branch-base correction: plain strings, off main                                                                                                                               |
| R8 HTTP cache           | D4: middleware structurally absent in-unit + unique varyBy keys                                                                                                                    |
| R9 live defects         | D4 shape line + Layer-B deletion; filed SMELL-101, never pinned as expected                                                                                                        |

## File Changes

| File                                                                        | Action        | Description                                            |
| --------------------------------------------------------------------------- | ------------- | ------------------------------------------------------ |
| `packages/core/domain/src/repositories/ProjectQueryRepository.ts`           | Modify        | +2 methods, +ChannelRefDto/PostExportRowDto            |
| `packages/core/domain/src/repositories/ThreadReadRepository.ts`             | Modify        | +1 method, +ThreadRefDto                               |
| `packages/core/domain/src/repositories/AnalyticsReadRepository.ts`          | Modify        | +1 method, +ProjectEntriesOptions                      |
| `apps/api/src/infrastructure/repositories/PrismaProjectQueryRepository.ts`  | Modify        | 2 adapter methods                                      |
| `apps/api/src/infrastructure/repositories/PrismaThreadReadRepository.ts`    | Modify        | 1 adapter method                                       |
| `apps/api/src/infrastructure/repositories/PrismaAnalyticsReadRepository.ts` | Modify        | 1 adapter method                                       |
| `apps/api/src/analytics/analyticsRoutes.ts`                                 | Modify        | 10 sites, ctor, plugin :976-1013, imports, stale JSDoc |
| `apps/api/tests/unit/analytics/analyticsRoutes.characterization.test.ts`    | Create        | shape pins + transient byte-identity goldens           |
| `apps/api/tests/unit/` adapter tests (Project/Thread/Analytics read repos)  | Create/Modify | new-method units incl. credential proof                |
| `docs/reports/roadmap-detected-smells-backlog.md`                           | Modify        | close 98; add 99/100/101 with owners                   |

## Testing Strategy

| Layer         | What                                                                             | Approach                                                                           |
| ------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Unit (vitest) | 3 handlers characterization (json+csv), 4 adapter methods, credential projection | app.inject + extended mockPrisma with semantic patches; planted-mutation red proof |
| Integration   | none new                                                                         | no schema/RLS/queue surface; existing tiers untouched                              |
| E2E           | none                                                                             | —                                                                                  |

## Threat Matrix

N/A — no routing-behaviour, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Route registrations are untouched; only the data-access seam behind existing handlers moves.

## Migration / Rollout

No migration. Pure refactor: no schema, config, or data movement. Single `git revert` of the merge commit restores the prior state; characterization tests are additive and survive a revert harmlessly (golden layer already deleted by merge time).

## Open Questions

None blocking. Layer-B deletion as the PR's last work unit: confirmed (retention would enshrine R9).
