# Exploration: analytics-route-port-integrity (SMELL-98)

> Materialized from Engram `sdd/analytics-route-port-integrity/explore` (obs 679).

## Current State

`apps/api/src/analytics/analyticsRoutes.ts` (1138 lines) holds `AnalyticsRouteHandler`, whose
constructor (`:131-143`) takes `PrismaClient` as its FIRST parameter alongside
`ProjectQueryRepositoryPort` (`:134`). Twelve routes are registered (`:1016-1135`), all with
`preHandler: [requireClientAuth]`. Of twelve handlers, four are `501 not implemented` stubs
(`getEngagementTrends :440`, `getBestPostingTimes :474`, `getGeographicAnalytics :509`,
`getMediaPerformance :539`), two delegate cleanly to use cases (`getROI :186`,
`getCrossPlatform :229`), two delegate to `ThreadAnalytics`, one is the SSE stream (port-clean),
and **three carry all ten direct `this.prisma.*` reads**.

Security is NOT the subject and was re-verified: every project-scoped handler gates with
`this.projectRepository.getProjectAccess(user.accountId, projectId)` before any read
(`:180, :223, :265, :433, :469, :503, :534, :564, :694, :935`). The residue is layering, not a leak.

**Nothing currently gates this smell.** Fitness `#1` greps `import { prisma` inside `*[Rr]outes*`
— the file imports `type PrismaClient` (`:18`) and resolves from DI (`:977`), so `#1` = 0.
Fitness `#21` greps the same singleton import — also 0. The canon rule ("routes resolve use cases
only, never repositories, never prisma", ARCHITECTURE_CANON §DI) is real and UNGATED here.

## The ten call sites, enumerated

| #   | Line       | Query                                                                                                                            | Handler               | Feeds                                        |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------- |
| 1   | `:575`     | `post.count({projectId, deletedAt:null})`                                                                                        | `getDashboard`        | `overview.totalPosts`                        |
| 2   | `:576-579` | `channel.findMany({projectId,deletedAt:null}, select id/provider/handle)`                                                        | `getDashboard`        | `platformMetrics[]` rows                     |
| 3   | `:580-590` | `analytics.findMany({post:{projectId,deletedAt:null}, capturedAt:{gte}}, include post.id, order capturedAt desc, take 500)`      | `getDashboard`        | all engagement totals                        |
| 4   | `:702-704` | `project.findFirst({id, deletedAt:null})`                                                                                        | `exportAnalytics`     | `project.name` only (`:771`) + denied branch |
| 5   | `:716-727` | `post.findMany({projectId,deletedAt:null}, select id/status/scheduledAt/publishedAt/createdAt, order createdAt desc, take 1000)` | `exportAnalytics`     | `posts[]`, CSV post join                     |
| 6   | `:729-732` | `channel.findMany` (identical to #2)                                                                                             | `exportAnalytics`     | `channels[]`, CSV handle join                |
| 7   | `:734-752` | `analytics.findMany(select 9 fields, capturedAt gte, order desc, take 5000)`                                                     | `exportAnalytics`     | `analytics[]`, CSV rows, `summary`           |
| 8   | `:755-764` | `thread.findMany({post:{projectId,deletedAt:null}}, select id/postId/strategy/createdAt, take 1000)`                             | `exportAnalytics`     | `threads[]`, `summary.totalThreads`          |
| 9   | `:942`     | `post.count({projectId, deletedAt:null})`                                                                                        | `getProjectAnalytics` | `postCount`                                  |
| 10  | `:943-947` | `analytics.findMany({post:{projectId,deletedAt:null}}, order desc, take 100)`                                                    | `getProjectAnalytics` | all four totals                              |

## Port landscape — what already exists

All four tokens are already declared and registered:
`types.ts:48 ProjectQueryRepository`, `:49 AnalyticsReadRepository`, `:50 ThreadReadRepository`,
`:54 PostQueryRepository`; wired in `setupRepositories.ts:113,156,162,168`.

**Three EXACT reuses (byte-equivalent `where`):**

- #1, #9 → `ProjectQueryRepositoryPort.countPosts(projectId)`; adapter
  `PrismaProjectQueryRepository.ts:114-118` is `post.count({where:{projectId, deletedAt:null}})`.
- #4 → `ProjectQueryRepositoryPort.findById(projectId)`; adapter `:156-163` is
  `project.findFirst({where:{id:projectId, deletedAt:null}})`. Route reads only `.name`,
  `ProjectDto` carries it.

**Three NEAR-exact reuses:** #3, #7, #10 → `AnalyticsReadRepositoryPort.getByProjectId(projectId, {startDate, take, orderBy})`
(port `AnalyticsReadRepository.ts:150`). Payload is EXACT for #7: the `Analytics` model has
exactly the nine columns the route selects (`schema.prisma:959-978` — id, postId, channelId,
provider, views, likes, comments, shares, capturedAt), so a full-row return adds nothing.
For #3 the route's `include:{post:{select:{id:true}}}` (`:585-587`) is **dead** — the handler
reads `e.postId` (`:622`), never `entry.post` — so dropping it is invisible.
The divergence is the query SHAPE, see R2.

**Four need NEW narrow methods:** #2/#6 (channel), #5 (post), #8 (thread). Details in Risks.

**Four analytics ports already exist** (`AnalyticsQueryRepository`, `AnalyticsReadRepository`,
`AnalyticsWriteRepository`, `AnalyticsAggregationQueryPort`). Do NOT add a fifth — reuse
`AnalyticsReadRepository`, which is the one registered for this consumer family.

**Established use-case precedent** in the same file: `setupAnalyticsUseCases.ts:66-92` composes
adapters from `ProjectQueryRepository` + `AnalyticsReadRepository`; `GetHistoricalAnalyticsQuery.ts`
is a 67-line query class receiving one port. The route already resolves two use cases
(`:992-998`) and consumes them through `mapErrorCode` (`:146-156`).

## Soft-delete / fitness #38 posture

`SWEPT = account channel post project`; `analytics` and `thread` are NOT in `MODELS`, and
`tenantGuard.ts` enrols only `channel:106`, `post:128`, `project:131`.

- **Six of ten sites are #38-scanned today** (#1 #2 #4 #5 #6 #9) and all pass — `deletedAt`
  sits inside the call+9 window in each.
- **Four are invisible to #38** (#3 #7 #10 analytics, #8 thread). This is #38's own documented
  residual (4): "nested reads THROUGH a soft-deletable relation on a non-swept accessor
  (`analytics.findMany({ where: { post: ... } })`) are not matched at all" — the doc's example
  is literally this file's shape.
- **After the move, posture is unchanged or better.** The three exact reuses land in
  `PrismaProjectQueryRepository.ts`, still in `apps/api/src` scope, each already compliant.
- **Hard constraint for new adapter methods:** inline `deletedAt: null` INSIDE the call's own
  `where`. A `deletedAt` seed hoisted into a shared where-builder above the call falls outside
  the +9 window and becomes a hard-zero #38 violation whose only escape is a new file exception
  — and that list may only shrink (the `PrismaPostRepository`/`PrismaPostQueryRepository`
  entries exist for exactly this hoisted-builder shape).
- **Do NOT put these in `packages/adapters/db-prisma`** — that directory is the #38 RATCHET
  (baseline 11, SMELL-87) and has no ambient request context.
- **Guard coverage IMPROVES, quietly.** `analytics` is not accountId-bearing, so the tenant
  guard injects nothing into #3/#7/#10 today; their tenancy is the hand-written `post:{...}`
  relation predicate plus `getProjectAccess`. `AnalyticsReadRepository.getByProjectId`
  (`PrismaAnalyticsReadRepository.ts:80-83`) opens with a guard-enrolled
  `post.findMany({projectId, deletedAt:null})`, so layer 1 does apply to the scoping step.
  Not a live fix (layer 0 already gates), but the change is zero _observable_ behaviour change,
  not zero security-posture change. Say so rather than claiming pure equivalence.

## Code judgement (per the "explore judges quality" rule)

**Overall: ARREGLABLE, not MAL HECHO.** The DI wiring is clean (injected client, no singleton,
no fitness violation); what is wrong is the LAYER — a `@layer infrastructure` route performing
read-model assembly. But three real defects were found in the code that would be MOVED, and they
change the recommendation:

1. **`getDashboard` double-counts per channel — LIVE BUG.** `providerGroups` keys by
   `entry.provider` (`:601-608`); `platformMetrics` then does
   `providerGroups[channel.provider] ?? []` (`:611-613`). Two channels on the same provider each
   receive the FULL provider-wide entry set, so `totalEngagement`, `totalReach`, `totalImpressions`
   and `totalPosts` are duplicated per channel and `topPlatform` (`:640-645`) picks arbitrarily
   between identical twins. `Analytics.channelId` (`schema.prisma:962`) is the correct join key
   and is ignored.
2. **Caps presented as totals.** `take: 500` (`:589`), `take: 5000` (`:751`), `take: 100` (`:946`)
   truncate silently; the responses label the results `totalViews`/`totalLikes`/`postCount` with
   no truncation flag. `summary.totalPosts: posts.length` (`:788`) is row count (<=1000) labelled
   "total". `getProjectAnalytics` is worst: `take: 100` with NO date filter, so "project totals"
   are the 100 most recent captures of all time.
3. **CSV emits permanently blank columns.** With `includePosts=false`, `posts` is `[]` (`:728`),
   `postMap` is empty (`:884`), yet the column set still declares `postStatus` and `publishedAt`
   (`:810, :825`), so `format=csv&includePosts=false` returns two always-empty columns.
4. Fake-data shape persists: `totalClicks: 0`, `followerCount: 0`, `growthRate: 0` (`:632-634`),
   `growthThisWeek: 0` (`:658`) — the class that got `GeoAnalyticsService` deleted (`:29`).

`exportAnalytics` also re-reads the project (`:702`) that `getProjectAccess` (`:694`) already
proved exists, is live and is owned — a second round-trip for one column (`name`).

## Approaches

1. **A — Port-only swap.** Replace all ten sites with port calls (3 exact reuses, 3 near-exact,
   4 new narrow methods), drop `PrismaClient` from the ctor and the plugin. Aggregation stays in
   the route.
   - Pros: smallest diff; removes the actual canon violation (the injected client); fits the
     stated CODE budget; closes the SMELL-98 row exactly as written.
   - Cons: ~70 lines of read-model assembly remain in an infrastructure route — the "paradox" is
     fixed, the CQRS layering is not.
   - Effort: Low-Medium. CODE ~135-185.

2. **B — Full CQRS query use cases.** Add `GetAnalyticsDashboardQuery`, `ExportAnalyticsQuery`,
   `GetProjectAnalyticsSummaryQuery` to `packages/core/analytics/src/`, route resolves them like
   it already resolves ROI/cross-platform.
   - Pros: satisfies both canon rules; aggregation becomes unit-testable without Fastify; matches
     the file's own precedent at `:164-240`.
   - Cons: CODE ~250-350, over the ceiling; and it moves THREE unfixed correctness bugs into a
     new home under a zero-behaviour-change promise.
   - Effort: Medium-High.

3. **C — B, preceded by fixing the aggregation.** Fix double-count + truncation honesty first,
   then extract.
   - Pros: the only sequence where the extracted use case is worth keeping.
   - Cons: no longer zero behaviour change; needs product sign-off on what the dashboard numbers
     should MEAN; two or three PRs.
   - Effort: High.

## Recommendation

**Approach A**, with B declared as the named successor and C as the real destination.

The decisive argument is not budget, it is Strict TDD. This file has **zero characterization
tests** (see R5), so the tests must be written first — and tests written first against
Approach B would PIN the per-channel double-count as expected output. Moving defective
arithmetic into a use case, under a zero-behaviour-change contract, with fresh tests asserting
the defect, is strictly worse than leaving it where the backlog can see it. Extract the DATA
ACCESS now; extract the ASSEMBLY after the assembly is correct.

Concretely: 3 new port methods + 3 adapter methods + rewiring 10 sites + ctor/plugin/container.
For #4 use `findById` (one line, exact); do NOT widen `getProjectAccess` to return the name —
it has 11 call sites and that is a different change.

**Where the honest answer is "do not extract":** #4's redundant re-read should ideally be
DELETED, not ported (the gate already proved liveness); porting it preserves a needless
round-trip. Ported anyway here because deleting it means widening a port used by 11 handlers.
File the round-trip. And do NOT route #5 through `PostQueryRepository.listByProject`
(`PostRepository.ts:271-277`): it demands `TenantScope`/`ProjectId` value objects built inside a
route, returns a paginated envelope over a different read model, and adds a COUNT query — over-
engineering for a five-column list.

## Risks

- **R1 HIGH / SECURITY — reusing `getChannelsByProject` in the export leaks credential material.**
  The adapter (`PrismaProjectQueryRepository.ts:180-186`) does `channel.findMany` with NO `select`
  and casts `rows as unknown as ChannelDto[]`. The real `Channel` model carries
  `credentialsCiphertext`, `credentialsIv`, `credentialsAuthTag`, `credentialsKeyVersion`
  (`schema.prisma:839-842`) — and `ChannelDto.credentials` (`ReadModelDtos.ts:200`) is a PHANTOM
  field the schema does not have, so the DTO has drifted from the table. `exportAnalytics`
  SPREADS its channels into the customer payload (`:783-786`), so the swap would ship IV +
  auth tag + ciphertext + key version into a tenant-downloadable JSON/CSV. **TypeScript cannot
  catch this** — the cast lies and the spread is structural. Today's single consumer
  (`crossPlatform/dataFetcher.ts:133-137`) projects explicitly, so the overfetch is cost, not
  leak, there. `getDashboard` builds an explicit literal (`:624-636`) and is also safe. **Only
  the export spreads.** Required: a narrow `select`-bearing method, not `getChannelsByProject`.
  SECURITY_CANON admits no marker here.
- **R2 MEDIUM / perf — `getByProjectId` is a different query plan.** `PrismaAnalyticsReadRepository.ts:80-100`
  is TWO steps: an UNBOUNDED `post.findMany({projectId, deletedAt:null}, select:{id}})` then
  `analytics.findMany({postId:{in: allIds}})`. The route today is one nested join. Semantics
  match; cost may not. Measure, or add a single-query method.
- **R3 MEDIUM / contract — `ThreadReadRepository.getByProjectId`** (`PrismaThreadReadRepository.ts:118-124`)
  shares the exact `where` but adds `THREAD_WITH_TWEETS_INCLUDE` and has NO `take`.
- **R4 MEDIUM / contract — post shape.** Returning `PostDto` for #5 adds fields to the export's
  `posts[]`. Preserve the five-field select.
- **R5 MEDIUM / test — the declared net does not exist.** `apps/api/tests/unit/analyticsRoutes.test.ts:94`
  imports `../../src/admin/analyticsRoutes.js` — a DIFFERENT file with the same basename.
  `analytics.flow.test.ts` never invokes a handler. Net coverage: `getDashboard` 0,
  `exportAnalytics` 0, `getProjectAnalytics` one status code. Characterization is NEW work.
- **R6 LOW-MED / fitness #38 —** inline `deletedAt: null` per call; stay out of db-prisma.
- **R7 LOW / sequencing —** two port conventions live (`TenantScope` vs plain strings); pick one
  and justify.
- **R8 LOW / verification —** `/analytics/dashboard` is HTTP-cached (`cacheConfig.ts:73-78`,
  5 min, `varyBy: projectId + timeRange`); repeated test keys can mask a regression.
- **R9 MUST FILE, NOT FIX — the four defects under §Code judgement.** Characterization pins
  SHAPE, not arithmetic, or this change enshrines the double-count as canon.

## Budget

- CODE: **~135-185** (ports ~25, adapters ~35, rewires ~60, wiring ~15), inside the ceiling.
- EVIDENCE: **~400-550** (characterization from zero ~250-400, adapter units ~120+). Single PR.
- Tokenless — which also means no fitness gate can be added for the ungated canon rule here
  (a gate needs a fitness.yml mirror = tokened workflow edit, separate change).

## Ready for Proposal

Yes. One decision needed before propose: R9 filed-only (recommended) vs folded in — resolved by
Edward's signed zero-behaviour scope: FILED.
