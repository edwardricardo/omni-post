# Proposal: RecurringPost + TrackedLink Tenant Guard (Slice 3)

## Intent

Slice 3 of the `project-scoped-tenant-guard` rollout. Two `projectId`-only models — `RecurringPost` and `TrackedLink` — are enrolled in NEITHER isolation layer (absent from `TENANT_SCOPED_MODELS`, `tenantGuard.ts:90-144`, 53 models; no RLS policy). Both expose LIVE cross-tenant IDOR (CWE-639). This slice applies the Approach-A recipe to both and ESTABLISHES the rollout's first `withSystemContext()` wraps (`tenantContext.ts:131`) — both models have genuine out-of-tenant-context callers.

## Verification (all claims checked at source)

| Claim                                                                             | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TrackedLink app-level IDOR hotfix (`requireTenantContext` + scoped `findFirst`)   | **REFUTED ON THIS BRANCH.** `PrismaTrackedLinkRepository.findById`/`delete` use UNSCOPED `findUnique` (`PrismaTrackedLinkRepository.ts:90,148`); zero `requireTenantContext` references; no `trackedlink-tenant-isolation` spec, no archived change, no two-tenant link test. The `trackedlink-idor-fix` (PR #109, engram obs 256) exists on a main this stacked chain does NOT include. Read/delete IDOR is LIVE here. |
| TrackedLink write-side IDOR (obs 252): create accepts foreign `projectId`         | CONFIRMED — `CreateTrackedLinkUseCase.ts:36` validates UUID shape only; no ProjectRepository                                                                                                                                                                                                                                                                                                                            |
| RecurringPost: 5 routes, all id-only or client-`projectId`, zero ownership checks | CONFIRMED (`recurringPostRoutes.ts`; repo `findById`/`findByProjectId` unscoped, `PrismaRecurringPostRepository.ts:105,128`)                                                                                                                                                                                                                                                                                            |
| RecurringPost create accepts THREE foreign parent refs                            | CONFIRMED — `projectId` (shape-only, `CreateRecurringPostUseCase.ts:83`), `templatePostId` + `channels[]` (unvalidated). Escalation: foreign `templatePostId` → scheduler clones B's post CONTENT for A (content exfiltration via `CreatePostFromRecurrenceUseCase.ts:116`); foreign `channels[]` → cross-tenant publish targeting. PATCH repoints `channels[]` (repoint path).                                         |
| Out-of-context callers: RecurringPost = 1, TrackedLink = public redirect          | CONFIRMED — inventory below                                                                                                                                                                                                                                                                                                                                                                                             |

## Route-surface audit (reads AND writes — per the Slice-2 extended recipe)

**RecurringPost** (`recurringPostRoutes.ts`, all `requireClientAuth`):

| Route                       | Line | Data path                                                | Status / gap class                                          |
| --------------------------- | ---- | -------------------------------------------------------- | ----------------------------------------------------------- |
| POST /recurring-posts       | 296  | create; client `projectId`+`templatePostId`+`channels[]` | Create-path ownership gap ×3 refs (Requirement 3)           |
| GET /recurring-posts (list) | 306  | `findByProjectId` — trusts client projectId              | LIVE list IDOR → guard-natural close                        |
| GET /recurring-posts/:id    | 316  | `findById` id-only                                       | LIVE read IDOR → guard-natural close                        |
| PATCH /recurring-posts/:id  | 326  | `findById`+`save`; body repoints `channels[]`            | LIVE write IDOR + channel-repoint ownership gap             |
| DELETE /recurring-posts/:id | 336  | deactivate id-only                                       | LIVE deactivate IDOR (automation DoS) → guard-natural close |

**TrackedLink** (`linkRoutes.ts` + `utmRoutes.ts`):

| Route                 | Line           | Data path                                                         | Status / gap class                                                                                  |
| --------------------- | -------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| POST /links           | linkRoutes:232 | create; client `projectId`; `isShortCodeAvailable` global check   | Create-path ownership gap (obs 252) + global-uniqueness check breaks under scoping                  |
| GET /links/:id        | linkRoutes:240 | `findById` unscoped                                               | LIVE read IDOR → guard-natural close                                                                |
| GET /links/:id/stats  | linkRoutes:248 | `findById` THEN `getClickStats` → `linkClick.findMany` (repo:214) | **Child-table READ traversal** (obs 285 class): closed only by upstream findById; suite MUST pin it |
| DELETE /links/:id     | linkRoutes:256 | `findById` + `delete` → `linkClick.deleteMany` (repo:158)         | LIVE delete IDOR; child-table WRITE gated by parent lookup — must stay                              |
| GET /r/:shortCode     | linkRoutes:266 | PUBLIC (no auth) → `findByShortCode` + `recordClick`              | Context-less caller — decision below                                                                |
| POST /links:id/utm    | utmRoutes:171  | `GenerateUTMLinksUseCase` `findById`+`save` (utm UC:92,106)       | LIVE write IDOR → guard-natural close                                                               |
| GET /links:id/utm-url | utmRoutes:180  | id-only read                                                      | LIVE read IDOR → guard-natural close                                                                |

`LinkClick` stays OUT of `TENANT_SCOPED_MODELS` (no accountId; gated transitively via guarded parent lookups — same policy as `campaignPost`).

## Out-of-tenant-context caller inventory (source-verified)

| #   | Caller                                                                  | Where                                                                                                                                | Decision proposed                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | RecurrenceScheduler 60s tick → `findActiveByNextScheduled` + `save`     | `RecurrenceScheduler.ts:74-119`; `ProcessRecurrenceUseCase.ts:81,126`; started `apps/api/src/index.ts:814-820`                       | Wrap tick in `withSystemContext("recurrence-sweep")` — cross-account sweep by design; also covers `CreatePostFromRecurrenceUseCase` post-clone (Post unenrolled, safe)                                                                       |
| 2   | Public redirect `GET /r/:shortCode` → `findByShortCode` + `recordClick` | `linkRoutes.ts:266`; `RedirectAndTrackClickUseCase.ts:30,65`; repo `:106,172-202` (writes `linkClick.create` + `trackedLink.update`) | Wrap in `withSystemContext("public-link-redirect")` — public-by-design: shortCode is a global-namespace capability token served to anonymous visitors; without wrap the guard flip BREAKS every published short link (**CRITICAL decision**) |
| 3   | `isShortCodeAvailable` — global uniqueness probe under TENANT context   | `PrismaTrackedLinkRepository.ts:236-244`, called `CreateTrackedLinkUseCase.ts:48`                                                    | Scoped check misses foreign codes → false-available → P2002 at insert. Wrap probe in `withSystemContext` (boolean only, no data exposure) — design confirms                                                                                  |

Workers/seeds/scripts: ZERO references to either model (verified).

## Scope

### In Scope

- Both models: `accountId` denormalization (nullable → backfill from `Project` over `projectId` FK → assert 0 NULL → NOT NULL → FK Cascade → accountId-led index), `TENANT_SCOPED_MODELS` append (53→55), forward RLS migration pair (+down.sql), timestamps **> `20260714030300`**, column-before-RLS.
- `withSystemContext()` wraps per inventory above (rollout precedent — document pattern in `MULTI_TENANT_GUARDS.md`).
- Create/repoint ownership: TrackedLink create (`projectId`); RecurringPost create (`projectId` + `templatePostId` + `channels[]`) and PATCH channel repoint → 404 NOT_FOUND (never 403/500).
- Two-tenant real-DB integration suite per model covering **ALL routes** (5 + 7, incl. public redirect positive control), per-row `accountId == project.accountId` invariant, positive controls for exfil sentinels (stats child-table traversal, template-clone content).
- Fold-in policy for the app-level TrackedLink hotfix IF it arrives via rebase/merge: structural guard is authoritative; transitive-join scoping may be simplified where redundant, anti-enumeration (foreign == nonexistent == 404) preserved.

### Out of Scope

- `LinkClick` enrollment (no accountId — transitive gating); the remaining rollout models (GeneratedImage, ProjectMember, Channel, Post); N-SEC-4; fixing the `/links:id/utm` path quirk (pre-existing, non-security).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `multi-tenant-isolation`: append both models to Requirement-1 + Requirement-3 tables; add two model-scoped Requirement-2 blocks (RecurringPost read/mutate/deactivate + template-clone exfil closure; TrackedLink read/write/stats-traversal closure); add the out-of-context-caller/`withSystemContext` precedent to Requirement "No caller regression" applications.

## Approach

ONE change, both models (identical recipe, shared harness). Apply Slice-1/2 recipe verbatim + create-path assertions + the three `withSystemContext` wraps BEFORE the guard flip (living-spec "No caller regression"). Index shape: composite `@@index([accountId, projectId])` candidates (both models' dominant guarded reads are project-filtered) — design decides.

## Affected Areas

| Area                                                    | Impact   | Description                                            |
| ------------------------------------------------------- | -------- | ------------------------------------------------------ |
| `infra/prisma/schema.prisma` + 4 migrations (+down.sql) | Mod/New  | accountId ×2, RLS ×2 — SENSITIVE                       |
| `infra/prisma/src/extensions/tenantGuard.ts`            | Modified | append 2 model names — SENSITIVE                       |
| `packages/core/{recurring,links}/src/**`                | Modified | accountId threading + create/repoint ownership         |
| `apps/api/src/{recurring,links,utm}/**`                 | Modified | `withSystemContext` wraps (redirect, scheduler tick)   |
| `apps/api/src/infrastructure/repositories/**`           | Modified | both Prisma adapters (threading; shortcode probe wrap) |
| `apps/api/tests/integration/**`                         | New      | two-tenant suite per model (all routes)                |
| `docs/security/MULTI_TENANT_GUARDS.md`                  | Modified | enrollment + system-context pattern docs               |

## Risks

| Risk                                                                                                                                       | Likelihood        | Mitigation                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Public redirect breaks at guard flip** (every published short link 500s)                                                                 | High if unwrapped | `withSystemContext` wrap ships in the SAME commit as the flip; integration test hits `/r/:shortCode` anonymously     |
| Branch divergence: `trackedlink-idor-fix` (PR #109) exists on main but not this chain → merge conflict on `PrismaTrackedLinkRepository.ts` | Med               | Orchestrator verifies origin/main before apply; fold-in policy defined in scope; suite is implementation-agnostic    |
| Scheduler tick regression (recurring pipeline silently dead post-flip)                                                                     | Med               | Wrap before flip; integration/unit test fires `tick()` via noop scheduler and asserts no `TenantContextMissingError` |
| Foreign `templatePostId`/`channels[]` missed → system-context clone exfiltrates B's content                                                | Med               | Create/repoint ownership checks in scope; suite includes foreign-template + foreign-channel 404 cases                |
| Vanity-slug false-available → P2002 500                                                                                                    | Med               | System-context probe wrap + conflict-path test                                                                       |
| Migration ordering collision                                                                                                               | Low               | Timestamps > `20260714030300`, column-before-RLS per model                                                           |

## Rollback

Revert branch (no merge until green). Post-merge: down.sql drops RLS policies, then `accountId` columns; remove both names from `TENANT_SCOPED_MODELS`; wraps are harmless without the guard. Additive column — no data loss.

## Dependencies

- Stacked on `workstream/cluster-c-schedreport-campaign-guard` @ `e506fea1` (guard=53, Slice-2 spec merged). New branch: `workstream/cluster-c-recurringpost-trackedlink-guard`.
- `omnipost-allow sensitive-edit` token at APPLY (`infra/prisma/**`); `pnpm db:up` for migration + integration tests.
- Delivery: single atomic PR, `size:exception` (migration + flip + wraps + tests are one deploy unit).

## Success Criteria

- [ ] Three legs present for both models (static) — schema, guard list, RLS.
- [ ] Two-tenant suite green over ALL 12 routes: foreign read/list/patch/deactivate/delete/stats/utm → empty/404; foreign create refs → 404 never 403/500; per-row `accountId == project.accountId`; positive exfil-sentinel controls.
- [ ] Anonymous `/r/:shortCode` still redirects (302) and records the click post-flip; scheduler `tick()` completes under system context.
- [ ] Zero NULL `accountId`, row counts preserved (backfill integrity).
- [ ] 0-defect gate (tsc, eslint --max-warnings 0, fitness #21/#23, full regression).

## Open Questions

1. **Public redirect** — **RESOLVED (FINAL, engram obs 297, Edward's signed decision 2026-07-14).** `withSystemContext("public-link-redirect")` — the capability-token model — is canon-verified and adopted, WITH mandatory compensating controls (namespace rate limiting on `/r/:shortCode`, absent today; see design D6/D7). The slice is NOT gated on any further product/security approval. The rejected alternative (pre-resolve accountId via a narrow raw/system read + bind a real TenantContext) added ceremony with zero isolation gain for an anonymous endpoint.
2. **Hotfix divergence** — should the slice branch rebase onto a main that includes PR #109 before apply, or absorb the conflict at merge time? Orchestrator/user call.
