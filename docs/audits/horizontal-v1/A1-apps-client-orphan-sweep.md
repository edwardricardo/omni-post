# Audit A.1 — apps/client orphan sweep

**Workstream**: `horizontal-audits-v1`
**Branch**: `workstream/horizontal-audits-v1`
**Date**: 2026-05-08
**Author**: Edward + Claude

## Scope

`apps/client` workspace — first audit of horizontal workstream. Goal: identify orphans (components/hooks/lib/pages with zero reachable importers) and execute trivial deletes in same PR.

Surface area inspected:

- 46 pages (`app/**/page.tsx`)
- 2 layouts (`app/**/layout.tsx`)
- 1 route handler (`app/**/route.ts`)
- 176 components (22 feature-scoped folders)
- 63 hooks (`hooks/api/**`)
- 11 hooks (`lib/hooks/**`)
- 45 lib utilities (`lib/**` excl. hooks)

**Total**: ~344 source files.

## Methodology

Multi-tool baseline (7 tools), cross-correlated, validated by independent agent review, formal 3-question filter.

| Tool                               | Purpose                                       | Outcome                                                                           |
| ---------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| `knip` 6.1.0                       | Unused files + exports + deps (Next.js-aware) | 9 unused files + 3 unused deps + 50+ unused exports                               |
| `madge` 8.0.0 (with `--ts-config`) | Graph orphans + circular deps                 | 14 orphan candidates (after path-alias resolution); zero circular deps            |
| `dependency-cruiser` 17.3.10       | `no-orphans` rule + layer enforcement         | 6 type-only false positives (TS types invisible to JS-level analyzer)             |
| `jscpd` 4.0.8                      | Duplicate code blocks                         | 8 clones (6 intra-file YELLOW, 2 inter-file dup candidates)                       |
| `vitest --coverage`                | Per-file coverage                             | 1 file with 0% (`hooks/api/useInbox/queries.ts`) — added partial-dead-code signal |
| `eslint --max-warnings 0`          | Unused vars/imports                           | Zero warnings — no intra-file dead code                                           |
| `depcheck`                         | Unused npm deps                               | 1 real candidate (false positive on CSS imports)                                  |

Cross-validation:

- Each knip "unused file" verified manually with `grep -rn` to find any importer.
- Each candidate routed through specialized `nextjs-frontend-architect` agent for Next.js-specific reachability check (server actions, dynamic imports, route groups, middleware, instrumentation, conventions).
- Architect verdict: **PROCEED with delete**.

3-question filter applied per canon `feedback_three_questions_before_delete`: origin (git log), purpose (JSDoc/README), duplication (overlap with existing).

## Findings

### DEAD — DELETE in this PR (10 files)

| #   | Path                                                       | Signals           | Origin    | Purpose                                         | Duplication                                              | LOC  |
| --- | ---------------------------------------------------------- | ----------------- | --------- | ----------------------------------------------- | -------------------------------------------------------- | ---- |
| 1   | `components/notifications/index.ts`                        | knip+madge+manual | sprint 0C | barrel re-export                                | none — barrel itself orphan                              | 8    |
| 2   | `components/notifications/NotificationBell.tsx`            | knip+madge+manual | sprint 0C | "Notification bell with unread badge + popover" | not duplicated, just unused                              | ~190 |
| 3   | `components/notifications/NotificationItem.tsx`            | knip+madge+manual | sprint 0C | "Single notification row in dropdown"           | not duplicated                                           | ~80  |
| 4   | `hooks/useNotificationStream.ts`                           | knip+madge+manual | sprint 0C | "EventSource SSE → Zustand store"               | not duplicated                                           | ~80  |
| 5   | `lib/stores/notificationStore.ts`                          | knip+madge+manual | sprint 0C | "Zustand store for notification state"          | not duplicated                                           | ~120 |
| 6   | `hooks/api/useContentLibrary.ts`                           | knip+madge+manual | sprint 0C | "TanStack hook GET /posts"                      | comment "should be wired in by parent" — never wired     | ~90  |
| 7   | `hooks/api/useUniversalAnalytics.ts`                       | knip+madge+manual | sprint 0C | "GET /api/backend/dashboard"                    | overlaps `useAnalytics.ts` + `usePerformanceInsights.ts` | ~80  |
| 8   | `hooks/api/useUsageMetrics.ts`                             | knip+madge+manual | sprint 0C | "Account usage metrics"                         | overlaps `useUsage.ts`                                   | ~50  |
| 9   | `lib/scalability/ConcurrentRenderer.tsx`                   | knip+madge+manual | Genesis   | "React 19 time-slicing/priority renderer"       | not duplicated                                           | ~120 |
| 10  | `tests/integration/ConcurrentRenderer.integration.test.ts` | manual            | 6w ago    | `describe.todo` test for #9                     | n/a                                                      | ~30  |

**Estimated LOC removed in this commit**: ~850 production + ~30 test = ~880 LOC.

The 5 notifications files form a transitively-orphan **constellation**: only the unused barrel `index.ts` (#1) imports the bell + item; the bell imports the store + stream; nothing else imports any of them. Pattern matches T3-I.5 (publishing constellation, 4033 LOC removed in workstream `refactor/remediation-v2.1`).

### CASCADE — Wave 2 (after Wave 1 deletes, in same PR)

After deleting #1-#5, the following become unused (knip + manual analysis):

**Hooks (will become unused-export, not unused-file)**:

- `hooks/api/useNotificationsApi/queries.ts` — `useNotificationsList`, `useNotificationsUnreadCount` (only consumed by NotificationBell)
- `hooks/api/useNotificationsApi/mutations.ts` — `useMarkNotificationRead`, `useMarkAllNotificationsRead` (only consumed by NotificationBell)
- `hooks/api/useNotificationsApi/index.ts` — re-exports above
- `lib/api/queries/notificationsQueries.ts` — `notificationsQueries` factory entries for list/unreadCount

**Test infrastructure (cascade-trim, not full delete)**:

- `tests/integration/useNotifications.integration.test.tsx` — sections testing list/unreadCount/markRead hooks (keep preferences-test sections only)
- `tests/mocks/handlers/notifications.ts` — 4 of 6 endpoints (`GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/mark-all-read`, `PATCH /notifications/:id/read`) become unused; trim to keep only preferences endpoints

**npm deps to remove**:

- `@radix-ui/react-popover` — used only by NotificationBell
- `@radix-ui/react-scroll-area` — used only by NotificationBell
- `zustand` — used only by notificationStore

These are executed in the same PR as Wave 1 to keep the commit history clean and avoid leaving the repo in a "knip will fail next run" state.

### YELLOW — Fix-it queue (NOT delete, refactor opportunities)

| Path                                                                                     | Issue                                                                                                                           | Priority | Est. effort      | Notes                                                 |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------- | ----------------------------------------------------- |
| `tests/mocks/handlers/notifications.ts`                                                  | jscpd clone #1 (intra-file)                                                                                                     | LOW      | 15min            | partially mitigated by Wave 2 cascade-trim            |
| `lib/hooks/useProjectChannels/mutations.ts`                                              | jscpd clone #2 (intra-file)                                                                                                     | LOW      | 20min            | extract shared mutation helper                        |
| `lib/api/clients/request.ts`                                                             | jscpd clone #3 (intra-file)                                                                                                     | LOW      | 20min            | extract shared request helper                         |
| `hooks/api/useRecurringPosts.ts`                                                         | jscpd clone #5 (intra-file)                                                                                                     | LOW      | 15min            | extract shared hook factory                           |
| `hooks/api/usePerformanceInsights.ts`                                                    | jscpd clone #6 (intra-file)                                                                                                     | LOW      | 15min            | similar                                               |
| `hooks/api/useMultiPlatformScheduling.ts`                                                | jscpd clone #7 (intra-file)                                                                                                     | LOW      | 20min            | similar                                               |
| `instagram/utils/generateVideoThumbnail.ts` ↔ `instagram/videoSplit/useVideoSegments.ts` | jscpd clone #4 (24 LOC inter-file)                                                                                              | MED      | 30min            | extract shared thumbnail helper to `instagram/utils/` |
| `templates/abTestTypes.ts` ↔ `lib/hooks/useABTests.ts`                                   | jscpd clone #8 (19 LOC inter-file)                                                                                              | MED      | 30min            | consolidate types into single source                  |
| `tests/integration/hooks.integration.test.ts`                                            | 6 `describe.todo` blocks (useAutoSave, useABTests, useTemplates, useTemplateVersions, useProviders) — stub tests for real hooks | MED      | per-hook ~1h     | implement or remove tests                             |
| `hooks/api/useInbox/queries.ts`                                                          | 0% test coverage despite being imported by tests                                                                                | LOW      | 30min            | add covering test or remove unused queries            |
| 37+ unused exports flagged by knip                                                       | mostly barrel re-exports "in case future consumers need it"                                                                     | LOW      | per-export ~5min | trim barrels                                          |

### NEEDS-FEATURE-SMOKE — None

All A.1 candidates resolved via reachability analysis. No findings deferred to feature-smoke audits (F.1-F.7).

### False positives identified (for audit methodology refinement)

| Tool                       | False positive                                                  | Lesson                                                                |
| -------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| `madge` (no `--ts-config`) | 131 false orphans (path aliases unresolved)                     | Always use `--ts-config` for TS projects with path mappings           |
| `dependency-cruiser`       | 6 type-only orphans (e.g. `types/scheduling.ts`, `apiTypes.ts`) | TS type imports are invisible at JS level — these aren't real orphans |
| `depcheck`                 | `tw-animate-css` flagged unused                                 | Imported via `@import` in `globals.css`; depcheck doesn't scan CSS    |
| `jscpd`                    | "0 tokens" on all clones                                        | Tokenizer config — line counts still accurate, treat as advisory      |

## Verification commands

```bash
# Pre-delete baselines
pnpm knip --workspace apps/client --reporter json > /tmp/A1-knip-pre.json
pnpm exec madge --orphans --extensions ts,tsx --ts-config apps/client/tsconfig.json apps/client > /tmp/A1-madge-pre.txt
pnpm exec depcruise --config .dependency-cruiser.cjs apps/client > /tmp/A1-cruiser-pre.txt

# Execute deletes (Wave 1 + 2)
# (See Phase F section in plan file)

# Post-delete validation
pnpm --filter @apps/client typecheck
pnpm --filter @apps/client test --run
pnpm --filter @apps/client lint --max-warnings 0
pnpm knip --workspace apps/client > /tmp/A1-knip-post.txt
diff /tmp/A1-knip-pre.txt /tmp/A1-knip-post.txt | wc -l  # expected: drop in unused-files count

# LOC delta
git diff --shortstat HEAD~1
```

## Summary

| Metric                     | Pre-A.1   | Post-A.1 (expected)             |
| -------------------------- | --------- | ------------------------------- |
| `apps/client` source files | ~344      | ~334                            |
| Knip unused files          | 9         | 0 (after Wave 1 + 2)            |
| Knip unused deps           | 3         | 0 (post deps removal)           |
| Production LOC             | ~baseline | -850                            |
| Test LOC                   | ~baseline | -30 (ConcurrentRenderer test)   |
| YELLOW fix-it queue        | n/a       | 11 entries (LOW + MED priority) |
| NEEDS-FEATURE-SMOKE        | n/a       | 0                               |

A.1 closes Phase 1 entry of the workstream; remaining 3 app-axis sweeps (A.2-A.4) follow per meta-plan order.
