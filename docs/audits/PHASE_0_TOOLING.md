# Phase 0 — Tooling deliverable

**Date:** 2026-05-12
**Status:** Checkpoint — Edward review required before Phase 1
**Scope:** install audit tooling, run base sweeps, capture raw outputs

---

## What was installed

Three devDependencies at repo root, pinned to exact latest-stable versions:

| Tool                        | Version                               | Purpose               |
| --------------------------- | ------------------------------------- | --------------------- |
| `knip@6.12.2`               | unused exports / files / deps / types | `pnpm exec knip`      |
| `madge@8.0.0`               | circular dependencies + import graph  | `pnpm exec madge`     |
| `dependency-cruiser@17.4.0` | cross-package dep graph + rule engine | `pnpm exec depcruise` |

Configs: **none yet**. Phase 1 will add `knip.json` + `.dependency-cruiser.cjs` so rules can be enforced; Phase 0 captures raw data only.

## Custom scripts created

Two single-purpose audit scripts under `scripts/`:

| Script                     | Purpose                                                                                                                                   | Run                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `audit-raw-sql.ts`         | Extract every `$queryRaw` / `$executeRaw` call, parse referenced tables/views/functions, cross-check against migrations + `schema.prisma` | `pnpm exec tsx scripts/audit-raw-sql.ts`         |
| `audit-routes-vs-hooks.ts` | Extract Fastify route registrations + frontend HTTP calls, cross-reference both directions                                                | `pnpm exec tsx scripts/audit-routes-vs-hooks.ts` |

Both write JSON output to `docs/audits/_raw/`. Console output prints a human summary.

## Graphify refresh

All 5 graphify-out directories rebuilt at HEAD (post-FN-007/008 commits):

- `apps/api/graphify-out/GRAPH_REPORT.md` (133 KB)
- `apps/admin/graphify-out/GRAPH_REPORT.md` (16 KB)
- `apps/client/graphify-out/GRAPH_REPORT.md` (28 KB)
- `apps/workers/graphify-out/GRAPH_REPORT.md` (6 KB)
- `packages/graphify-out/GRAPH_REPORT.md` (54 KB)

Snapshots copied to `docs/audits/_raw/graph-{surface}.md` so they remain auditable even after subsequent commits rebuild the in-tree graphs.

---

## Findings — Phase 0 raw sweep

### 1. Raw SQL → migration validity

**20 raw-SQL call sites detected.** 8 unique identifiers reference DB objects that do not exist in `infra/prisma/migrations/`:

| Missing identifier                                                                | Call sites                                       | Status                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| `tenant_dashboard_stats` (materialized view)                                      | `apps/api/src/database/DatabaseOptimizer.ts:145` | **façade** — already known                                            |
| `get_dashboard_posts(uuid,int,int)` (function)                                    | `apps/api/src/database/DatabaseOptimizer.ts:111` | **façade** — already known                                            |
| `hourly_analytics_summary` (materialized view)                                    | `apps/api/src/database/DatabaseOptimizer.ts:201` | **façade** — already known                                            |
| `performance_baseline` (table)                                                    | `apps/api/src/database/DatabaseOptimizer.ts:267` | **façade** — already known                                            |
| `baseline_metrics`, `current_metrics` (CTE/table)                                 | `apps/api/src/database/DatabaseOptimizer.ts:267` | **façade** — already known                                            |
| `connection_pool_stats` (table/view + `collect_connection_pool_stats()` function) | `apps/api/src/database/DatabaseOptimizer.ts:340` | **façade** — already known                                            |
| `conversions` (table)                                                             | `apps/api/src/analytics/roiCalculator.ts:185`    | **façade — NEW** (`INSERT INTO conversions` from `trackConversion()`) |

Full data: `docs/audits/_raw/raw-sql.json`.

### 2. Routes ↔ frontend hooks

**468 backend routes registered.** **161 frontend calls** detected (64 admin + 97 client).

- **10 unmatched frontend calls** (UI hitting endpoints that don't exist) — candidate bugs:

| Surface | Method | URL pattern                                    | Site                                              |
| ------- | ------ | ---------------------------------------------- | ------------------------------------------------- |
| admin   | GET    | `/admin/pricing/${segment}/${input.id}/status` | `apps/admin/hooks/api/usePricingTiers/api.ts:128` |
| admin   | GET    | `/projects`                                    | `apps/admin/hooks/api/useWebhooks/api.ts:92`      |
| client  | GET    | `/approvals/`                                  | `apps/client/hooks/api/useApprovals.ts:74`        |
| client  | GET    | `/crm/` (3 sites)                              | `apps/client/hooks/api/useCrm.ts:52,62,70`        |
| client  | GET    | `/inbox/conversations/` (2 sites)              | `apps/client/hooks/api/useInbox/api.ts:59,76`     |
| client  | GET    | `/inbox/messages/`                             | `apps/client/hooks/api/useInbox/api.ts:86`        |
| ...     |        |                                                | ... and 1 more                                    |

Note: many of these may be matchable if we account for trailing-slash variants or sub-path matching. Phase 1 will refine the matcher. Reading these as "definite bugs" needs manual verification per row.

- **300 unconsumed backend routes** (no detected frontend caller). Likely contains:
  - webhooks / OAuth callbacks (no UI by design)
  - public observability (health/metrics)
  - admin-only routes that may be called via SSR fetch we didn't capture
  - actually-dead routes (real findings)

Categorization is Phase 1 work — too noisy to action from Phase 0 raw output. Full data: `docs/audits/_raw/routes-vs-hooks.json`.

### 3. Circular dependencies (madge per surface)

| Surface            | Files | Circular deps | Status                                                   |
| ------------------ | ----- | ------------- | -------------------------------------------------------- |
| `apps/api/src`     | 952   | 0             | ✓ clean                                                  |
| `apps/admin`       | 272   | 0             | ✓ clean                                                  |
| `apps/client`      | 543   | 0             | ✓ clean                                                  |
| `apps/workers/src` | 135   | **1**         | ✗ `publishHandlerTypes.ts ↔ telemetry/initialization.ts` |
| `packages`         | 350   | 0             | ✓ clean                                                  |

One real finding: workers has 1 circular dep between publish handler types and telemetry init. Easy fix candidate but flagged for Phase 2 (workers inventory).

### 4. Knip — unused exports / files / deps

172 finding-entries grouped as:

| Category               | Count |
| ---------------------- | ----- |
| Unused files           | 5     |
| Unused exports         | 80    |
| Unused types           | 426   |
| Unused dependencies    | 20    |
| Unused devDependencies | 6     |
| Duplicate exports      | 1     |
| Unresolved imports     | 0     |

**Caveat**: knip with default config has known false positives in monorepos (workspace re-exports, dynamic imports, frameworks). A `knip.json` config in Phase 1 will tune this for our stack (Fastify routes registered dynamically, Next.js page conventions, etc.). For now, treat the unused-types/exports counts as upper bounds.

Full data: `docs/audits/_raw/knip.json`.

### 5. Dependency-cruiser graph

1805 modules mapped. **0 violations** — but this is meaningless without rules. Phase 1 will configure rules to enforce:

- `domain/` may not depend on `infrastructure/` or `application/`
- `application/` may not depend on `infrastructure/`
- `apps/admin/` may not depend on `apps/client/` and vice-versa
- packages may not depend on apps

Then re-run depcruise → expected real violations.

Raw graph: `docs/audits/_raw/depcruise.json` (2.1 MB).

---

## What this does NOT tell us yet

- **Duplication across admin vs client** (e.g., parallel hooks like `useMultiPlatformScheduling` already found case-by-case). Needs dedicated similarity comparison pass — Phase 1 cross-cutting C.
- **Type drift between `packages/shared` and consumers**. Phase 1 cross-cutting D.
- **Feature-separation violations** (admin-only feature accessed from client; client-only feature accessed from admin). Needs role/feature taxonomy + cross-ref. Phase 2 per-surface.
- **Per-surface god nodes + isolated communities**. Read directly from `graphify-out/GRAPH_REPORT.md` per target — Phase 2.
- **Runtime-validity of frontend hooks** (URL exists but backend handler returns 404 due to dynamic mount conditions). Needs runtime smoke — out of static-analysis scope.

---

## Phase 0 verdict (honest)

The base sweep:

- ✓ Confirmed the `DatabaseOptimizer` façade systematically (no longer narrative — it's a discrete script output)
- ✓ Found one **new** façade not previously flagged (`conversions` table in `roiCalculator.ts`)
- ✓ Quantified the routes-vs-hooks gap (10 candidate UI bugs + 300 backend routes needing categorization)
- ✓ Confirmed structural cleanliness on most surfaces (0 circular deps in 4/5 surfaces)
- ✓ Flagged 1 real circular dep in workers

The raw data alone is NOT a deliverable for action. Phase 1 (cross-cutting refinement) transforms these counts into actionable tables.

---

## Checkpoint — what I need from Edward

Before I proceed to Phase 1, confirm:

1. **Are the 10 unmatched UI calls worth investigating immediately** (Phase 1.5 mini-detour), or roll into Phase 1's full cross-cutting pass?
2. **Phase 1 ordering**: do you want me to run A/B/C/D cross-cutting passes **in parallel** (4 specialized agents simultaneously, faster, more context burn) or **sequential** (one agent at a time, slower, easier to review each)?
3. **`roiCalculator.ts:185` `conversions` table** — investigate now or batch with Phase 2 (apps/api inventory)?
4. **knip config in Phase 1**: I'll need ~30 min to tune knip rules for the monorepo. Approve?
5. **Anything missing** from Phase 0 you want me to add before moving on?

---

## Raw outputs index

| File                          | Description                                            |
| ----------------------------- | ------------------------------------------------------ |
| `_raw/raw-sql.json`           | Raw SQL site catalog + missing identifiers             |
| `_raw/routes-vs-hooks.json`   | Backend routes + frontend calls + unmatched/unconsumed |
| `_raw/knip.json`              | Knip unused exports/files/deps/types                   |
| `_raw/depcruise.json`         | Full module dependency graph (2.1 MB)                  |
| `_raw/madge-all.txt`          | Madge circular check summary per surface               |
| `_raw/madge-api-circular.txt` | Madge api detailed circular check                      |
| `_raw/graph-{surface}.md`     | Snapshot of graphify GRAPH_REPORT per surface          |
