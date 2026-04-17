# OmniPost — Audit of `apps/client/lib/hooks/`

> **Living document.** Update in place, do not re-date the filename.
> **Last verified:** 2026-04-17 against branch `Genesis`
> **Method:** Direct file reads + grep for consumers + grep for backend routes.
> **Scope:** 5 files in `apps/client/lib/hooks/`. Pure inventory + classification, no code changes.
> **CORRECTED 2026-04-17:** 3 hooks initially classified `DEAD_CODE` were reclassified to `LEGACY_WORKING` after a re-verification in PRE-2 caught a consumer missed by a truncated grep. See §10 for the correction audit.

Companion to [ENDPOINT_AUDIT.md](ENDPOINT_AUDIT.md) §3.2 and §5.

---

## 1. TL;DR

5 files, 4 with HTTP fetches, 1 purely local. No single file is fully CORRECT by `REACT_STANDARDS.md` §2 convention. Breakdown (post-correction 2026-04-17):

| Category                                                                             | Count | Hooks                                               |
| ------------------------------------------------------------------------------------ | ----: | --------------------------------------------------- |
| `DEAD_CODE` (0 production consumers)                                                 |     0 | —                                                   |
| `LEGACY_WORKING` (consumers exist, works via Next.js rewrite but violates standard)  |     3 | `useAutoSave`/`usePostDraft`, `useProviders`        |
| `LEGACY_WORKING_WITH_BROKEN_URLS` (consumers exist but 3-7 URLs per hook return 404) |     3 | `useABTests`, `useTemplates`, `useTemplateVersions` |
| `BROKEN` (consumers exist AND zero URLs resolve)                                     |     0 | —                                                   |
| `CORRECT` (standard-compliant in this folder)                                        |     0 | —                                                   |

**Deletable lines in this audit scope: 0.** All 5 files have production consumers. The 3 hooks previously marked `DEAD_CODE` are consumed by `apps/client/app/dashboard/templates/TemplateManagementDashboard.tsx`, routed at `/dashboard/templates`. See §10.

**Zero correlation with ENDPOINT_AUDIT §4 WRONG_APP** — those 5 contamination sites are in `hooks/api/` and `components/`, not `lib/hooks/`. Fixes are independent.

---

## 2. Key architectural finding

**The Next.js rewrite in [apps/client/next.config.mjs:15-22](apps/client/next.config.mjs#L15-L22) changes the premise of ENDPOINT_AUDIT §5:**

```javascript
async rewrites() {
  return [
    {
      source: "/api/:path*",
      destination: "http://localhost:3000/:path*", // Proxy to API server
    },
  ];
},
```

This means a hook calling `/api/projects/X/templates` → rewritten to `http://localhost:3000/projects/X/templates` — which **does exist** in Fastify (`templateRoutes.ts:35`). The `/api/` prefix is stripped, not a mismatch.

**Two routing paths coexist in `apps/client`:**

| Path                     | Hooks use it                 | Routing                                                       | Auth injection                                                        |
| ------------------------ | ---------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| `/api/backend/[...path]` | `hooks/api/*` (new standard) | Matched by `app/api/backend/[...path]/route.ts` route handler | **Yes** — handler injects `customer-session` Bearer + handles refresh |
| `/api/:path*`            | `lib/hooks/*` (legacy)       | Generic rewrite in `next.config.mjs`                          | **No custom logic** — cookies forwarded by default only               |

Hooks in `lib/hooks/*` that hit endpoints requiring `requireClientAuth` work only if the backend authenticates via cookie forwarding rather than Bearer. This is fragile and inconsistent with the rest of the app. Revising §5 of the endpoint audit to reflect this.

---

## 3. Per-file inventory

### 3.1 `useABTests.ts` (230 lines)

| Field                | Value                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Exports              | `useABTests(projectId, status?)`                                                               |
| Uses TanStack        | **Yes** — `useQuery` + 6 `useMutation`                                                         |
| HTTP method          | `fetch` (raw)                                                                                  |
| Production consumers | **1** — `app/dashboard/templates/TemplateManagementDashboard.tsx:17,69` (corrected 2026-04-17) |
| Test consumers       | 1 — `tests/integration/hooks.integration.test.ts:28` (`describe.todo` — skipped)               |

**URLs invoked and backend match:**

| Method | Client path                                            | Rewrites to                                        | Backend match                         |
| ------ | ------------------------------------------------------ | -------------------------------------------------- | ------------------------------------- |
| GET    | `/api/projects/:id/templates/ab-tests?status`          | `/projects/:id/templates/ab-tests`                 | **MATCH** `templateRoutes.ts:160`     |
| POST   | `/api/projects/:id/templates/ab-tests`                 | `/projects/:id/templates/ab-tests`                 | **MATCH** `templateRoutes.ts:169`     |
| PUT    | `/api/ab-tests/:id`                                    | `/ab-tests/:id`                                    | **NOT_FOUND**                         |
| POST   | `/api/projects/:id/templates/ab-tests/:testId/start`   | `/projects/:id/templates/ab-tests/:testId/start`   | **MATCH** `templateRoutes.ts:178`     |
| POST   | `/api/projects/:id/templates/ab-tests/:testId/pause`   | `/projects/:id/templates/ab-tests/:testId/pause`   | **NOT_FOUND** (only start/stop exist) |
| POST   | `/api/projects/:id/templates/ab-tests/:testId/stop`    | `/projects/:id/templates/ab-tests/:testId/stop`    | **MATCH** `templateRoutes.ts:187`     |
| DELETE | `/api/ab-tests/:id`                                    | `/ab-tests/:id`                                    | **NOT_FOUND**                         |
| GET    | `/api/projects/:id/templates/ab-tests/:testId/results` | `/projects/:id/templates/ab-tests/:testId/results` | **MATCH** `templateRoutes.ts:196`     |

**Category:** `LEGACY_WORKING_WITH_BROKEN_URLS` (corrected 2026-04-17 from `DEAD_CODE`). 1 production consumer. 3/8 URLs don't exist in backend — `update`, `pause`, `delete` mutations on the live `/dashboard/templates` page currently return 404.

### 3.2 `useAutoSave.ts` (207 lines)

| Field                | Value                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------- |
| Exports              | `useAutoSave(config)`, `usePostDraft(postId?)`                                               |
| Uses TanStack        | Indirectly via `useCreatePost`/`useUpdatePost` from `@/lib/api/hooks`                        |
| HTTP method          | None direct — localStorage + debounce + delegates to `@/lib/api/hooks`                       |
| Production consumers | **1** — `components/editor/ClientContentEditor.tsx:19,66` uses `usePostDraft`                |
| Test consumers       | 1 dedicated integration test file (`useAutoSave.integration.test.ts`, 141 lines, real tests) |

**URLs invoked:** none directly. Pure local state hook. Backend writes happen via delegated `useCreatePost`/`useUpdatePost` which live in `lib/api/hooks.ts` (separate path).

**Category:** `LEGACY_WORKING` — functions correctly, has real consumer, passes integration tests. Violates `REACT_STANDARDS.md` §2 location convention (should be in `hooks/` not `lib/hooks/`).

### 3.3 `useProviders.ts` (126 lines)

| Field                | Value                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Exports              | `useProviders()`, `useProviderStatusColor(status)`, `useProviderStatusLabel(status)`                       |
| Uses TanStack        | **Yes** — `useQuery`                                                                                       |
| HTTP method          | `fetch` (raw)                                                                                              |
| Production consumers | **2** — `components/editor/ClientContentEditor.tsx:15,55`, `components/publishing/PublishDialog.tsx:18,42` |
| Test consumers       | 1 dedicated integration test (`useProviders.integration.test.ts`, 170 lines, real tests)                   |
| Re-exports           | 1 — `lib/api/hooks.ts:173` re-exports it                                                                   |

**URLs invoked and backend match:**

| Method | Client path      | Rewrites to  | Backend match                     |
| ------ | ---------------- | ------------ | --------------------------------- |
| GET    | `/api/providers` | `/providers` | **MATCH** `providerRoutes.ts:252` |

**Naming conflict (unrelated but worth noting):** three distinct `useProviders` implementations coexist:

- `apps/client/lib/hooks/useProviders.ts` (this file, raw fetch)
- `apps/client/lib/api/hooks.ts` exports `useApiProviders as useProviders` via `lib/api/index.ts:31` (different impl)
- `apps/client/hooks/api/useChannels.ts:72-76` defines yet another `useProviders`

Current consumers explicitly import from `@/lib/hooks/useProviders`, so no ambiguity at call sites — but the naming collision is a footgun.

**Category:** `LEGACY_WORKING` — functions correctly (1/1 URL matches), active consumers. Violates convention: raw `fetch` (standard says "No raw `useEffect` + `fetch` + `useState` patterns"), wrong folder, direct `/api/*` path instead of `/api/backend/*`.

### 3.4 `useTemplates.ts` (173 lines)

| Field                | Value                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Exports              | `useTemplates(projectId)`                                                                      |
| Uses TanStack        | **Yes** — `useQuery` + 4 `useMutation`                                                         |
| HTTP method          | `fetch` (raw)                                                                                  |
| Production consumers | **1** — `app/dashboard/templates/TemplateManagementDashboard.tsx:16,59` (corrected 2026-04-17) |
| Test consumers       | 1 — `hooks.integration.test.ts:37` (`describe.todo` — skipped)                                 |

**URLs invoked and backend match:**

| Method | Client path                    | Rewrites to                | Backend match                                                                  |
| ------ | ------------------------------ | -------------------------- | ------------------------------------------------------------------------------ |
| GET    | `/api/projects/:id/templates`  | `/projects/:id/templates`  | **MATCH** `templateRoutes.ts:35`                                               |
| POST   | `/api/projects/:id/templates`  | `/projects/:id/templates`  | **MATCH** `templateRoutes.ts:53`                                               |
| PUT    | `/api/templates/:id`           | `/templates/:id`           | **NOT_FOUND** (backend has `/projects/:id/templates/:id` at line 62)           |
| DELETE | `/api/templates/:id`           | `/templates/:id`           | **NOT_FOUND** (backend has `/projects/:id/templates/:id` at line 71)           |
| POST   | `/api/templates/:id/duplicate` | `/templates/:id/duplicate` | **NOT_FOUND** (backend has `/projects/:id/templates/:id/duplicate` at line 82) |

**Category:** `LEGACY_WORKING_WITH_BROKEN_URLS` (corrected 2026-04-17). 1 production consumer. 3/5 URLs missing the `/projects/:id/` scope — `update`, `delete`, `duplicate` currently 404 on the live `/dashboard/templates` page.

### 3.5 `useTemplateVersions.ts` (138 lines)

| Field                | Value                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Exports              | `useTemplateVersions(templateId?, projectId?)`                                                 |
| Uses TanStack        | **Yes** — `useQuery` + 3 `useMutation`                                                         |
| HTTP method          | `fetch` (raw)                                                                                  |
| Production consumers | **1** — `app/dashboard/templates/TemplateManagementDashboard.tsx:19,77` (corrected 2026-04-17) |
| Test consumers       | 1 — `hooks.integration.test.ts:47` (`describe.todo` — skipped)                                 |

**URLs invoked and backend match:**

| Method | Client path                                                           | Rewrites to                                    | Backend match                     |
| ------ | --------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------- |
| GET    | `/api/projects/:id/templates/:templateId/versions`                    | `/projects/:id/templates/:templateId/versions` | **MATCH** `templateRoutes.ts:111` |
| POST   | `/api/projects/:id/templates/:templateId/versions`                    | same                                           | **MATCH** `templateRoutes.ts:120` |
| POST   | `/api/projects/:id/templates/:templateId/versions/:versionId/restore` | same                                           | **MATCH** `templateRoutes.ts:129` |
| DELETE | `/api/template-versions/:id`                                          | `/template-versions/:id`                       | **NOT_FOUND**                     |

**Category:** `LEGACY_WORKING_WITH_BROKEN_URLS` (corrected 2026-04-17). 1 production consumer. 1/4 URLs missing (DELETE) — version-delete currently 404s on the live `/dashboard/templates` page.

---

## 4. Classified summary

| Hook                           | Category                          |                                           Call sites | URLs (MATCH / NOT_FOUND / NEXT_ROUTE) | TanStack   | Action                                                                            |
| ------------------------------ | --------------------------------- | ---------------------------------------------------: | ------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `useABTests`                   | `LEGACY_WORKING_WITH_BROKEN_URLS` | 1 prod (TemplateManagementDashboard), 1 `.todo` test | 5 / 3 / 0                             | Yes        | Migrate + decide per-URL fate of 3 broken mutations                               |
| `useAutoSave` + `usePostDraft` | `LEGACY_WORKING`                  |            1 prod (ClientContentEditor), 1 real test | 0 / 0 / 0 (no HTTP)                   | Indirectly | Move to `apps/client/hooks/`                                                      |
| `useProviders`                 | `LEGACY_WORKING`                  |  2 prod (ContentEditor + PublishDialog), 1 real test | 1 / 0 / 0                             | Yes        | Migrate to `/api/backend/providers` + move to `hooks/api/` + resolve naming clash |
| `useTemplates`                 | `LEGACY_WORKING_WITH_BROKEN_URLS` | 1 prod (TemplateManagementDashboard), 1 `.todo` test | 2 / 3 / 0                             | Yes        | Migrate + decide per-URL fate of 3 broken mutations                               |
| `useTemplateVersions`          | `LEGACY_WORKING_WITH_BROKEN_URLS` | 1 prod (TemplateManagementDashboard), 1 `.todo` test | 3 / 1 / 0                             | Yes        | Migrate + decide per-URL fate of DELETE                                           |

---

## 5. Phase 4.1 — Numeric summary

```
Total hooks in apps/client/lib/hooks/: 5 (post-correction 2026-04-17)
  - DEAD_CODE (deletable):              0
  - BROKEN (live + zero URLs work):     0
  - LEGACY_WORKING (migrate):           2   (useAutoSave, useProviders)
  - LEGACY_WORKING_WITH_BROKEN_URLS:    3   (useABTests, useTemplates, useTemplateVersions)
  - CORRECT:                            0

Live silent 404s on production route /dashboard/templates:
  - useABTests mutations: update (PUT /api/ab-tests/:id), pause, delete
  - useTemplates mutations: update, delete, duplicate (all missing /projects/:id/ scope)
  - useTemplateVersions mutation: DELETE /api/template-versions/:id

Files outside lib/hooks/ that import from it: 4
  - apps/client/components/editor/ClientContentEditor.tsx (useProviders + usePostDraft)
  - apps/client/components/publishing/PublishDialog.tsx (useProviders)
  - apps/client/app/dashboard/templates/TemplateManagementDashboard.tsx (all 3 template hooks)
  - apps/client/lib/api/hooks.ts (re-exports useProviders)

Total deletable lines in scope of this audit: 0
```

---

## 6. Phase 4.2 — Actionable lists

### P0 — Silent 404s in production (NEW, surfaced by 2026-04-17 correction)

The `/dashboard/templates` page uses 7 distinct mutation actions that call URLs with **no matching backend route**. Users clicking update/delete/duplicate/pause buttons get errors thrown inside the mutations (hook throws `Error("Failed to update A/B test")` etc.). Customer-visible failure mode.

| Hook                  | Broken URL                                                | Expected backend equivalent                                                                       | Action required                                        |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `useABTests`          | `PUT /api/ab-tests/:id`                                   | Possibly `PUT /projects/:id/templates/ab-tests/:testId`? Or remove UI action                      | Edward decides                                         |
| `useABTests`          | `POST /api/projects/:id/templates/ab-tests/:testId/pause` | Not in backend (only start + stop exist)                                                          | Edward decides                                         |
| `useABTests`          | `DELETE /api/ab-tests/:id`                                | Possibly `DELETE /projects/:id/templates/ab-tests/:testId`?                                       | Edward decides                                         |
| `useTemplates`        | `PUT /api/templates/:id`                                  | Backend has `PUT /projects/:projectId/templates/:templateId` at `templateRoutes.ts:62`            | Fix client URL                                         |
| `useTemplates`        | `DELETE /api/templates/:id`                               | Backend has `DELETE /projects/:projectId/templates/:templateId` at `templateRoutes.ts:71`         | Fix client URL                                         |
| `useTemplates`        | `POST /api/templates/:id/duplicate`                       | Backend has `POST /projects/:projectId/templates/:templateId/duplicate` at `templateRoutes.ts:82` | Fix client URL                                         |
| `useTemplateVersions` | `DELETE /api/template-versions/:id`                       | Not in backend                                                                                    | Edward decides (remove UI action or add backend route) |

### P1 — DEAD_CODE deletions

**Empty — 0 files qualify.** Prior P1 claim (3 files, 541 lines) was a misclassification; see §10. Nothing to delete in this audit's scope.

### P2 — LEGACY_WORKING migrations (expanded)

| Hook                           | Current location                               | Target                                                                                      | Effort                                                                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useAutoSave` + `usePostDraft` | `apps/client/lib/hooks/useAutoSave.ts`         | `apps/client/hooks/useAutoSave.ts` (no `api/` subfolder because no HTTP)                    | **Trivial** — file move + update 1 import in `ClientContentEditor.tsx:19` + 1 in integration test                                                                                                                                      |
| `useProviders`                 | `apps/client/lib/hooks/useProviders.ts`        | `apps/client/hooks/api/useProviders.ts` + switch to `/api/backend/providers`                | **Medium** — file move, path switch, update 2 consumer imports, update 1 integration test path, resolve naming clash with the other two `useProviders` (either rename the other two or remove the re-export in `lib/api/hooks.ts:173`) |
| `useABTests`                   | `apps/client/lib/hooks/useABTests.ts`          | `apps/client/hooks/api/useABTests.ts` + switch to `/api/backend/*`                          | **Medium-High** — also depends on P0 above: 3 broken mutations need either a client URL fix (if backend has equivalents) or a backend route addition (if not). Update 1 consumer (`TemplateManagementDashboard.tsx`)                   |
| `useTemplates`                 | `apps/client/lib/hooks/useTemplates.ts`        | `apps/client/hooks/api/useTemplates.ts` + switch to `/api/backend/projects/:id/templates/*` | **Medium** — fix 3 URLs (add back `/projects/:id/` scope) + move + update 1 consumer                                                                                                                                                   |
| `useTemplateVersions`          | `apps/client/lib/hooks/useTemplateVersions.ts` | `apps/client/hooks/api/useTemplateVersions.ts`                                              | **Medium** — also depends on P0: DELETE mutation needs fate decision + move + update 1 consumer                                                                                                                                        |

The `useProviders` migration is a good place to standardize: 3 conflicting implementations of the same hook name should collapse to 1 source of truth.

---

## 7. Phase 4.3 — Correlation with ENDPOINT_AUDIT §4 (WRONG_APP)

ENDPOINT_AUDIT §4 identified 5 `WRONG_APP` call sites (admin endpoints invoked from client):

| #   | Site                                                              | Is in `lib/hooks/`? |
| --- | ----------------------------------------------------------------- | ------------------- |
| 1   | `apps/client/hooks/api/usePerformanceInsights.ts:132`             | No — `hooks/api/`   |
| 2   | `apps/client/hooks/api/useScheduledPosts.ts:39`                   | No — `hooks/api/`   |
| 3   | `apps/client/hooks/api/useScheduledPosts.ts:63`                   | No — `hooks/api/`   |
| 4   | `apps/client/components/publishing/publishingDashboardApi.ts:213` | No — not a hook     |
| 5   | `apps/client/components/notifications/NotificationItem.tsx:40`    | No — not a hook     |

**Zero correlation.** None of the `lib/hooks/*` files call admin-scoped endpoints. The two audits address independent problems:

- ENDPOINT_AUDIT §4 → client app consuming admin endpoints (client/admin separation regression).
- This audit → client app has two parallel hook conventions, one of them mostly dead code.

Fixing one does not fix the other. They can be scheduled independently.

---

## 8. Recommendation to Edward (rewritten 2026-04-17 after correction)

1. **P0 first (silent 404s in production):** review the 7 broken-URL table. For each, decide: fix client URL (when backend equivalent exists under `/projects/:id/` scope), add backend route, or remove UI action. `useTemplates` has 3 URLs that are trivial client-side fixes (missing `/projects/:id/` prefix). `useABTests` and `useTemplateVersions` need backend decisions.
2. **P2 `useAutoSave` move (low risk):** one-file move, two import updates.
3. **P2 `useProviders` migration (medium risk):** standardizes naming, resolves 3-way clash, migrates to proxied URL.
4. **P2 template-triad migration (medium-high risk):** after P0 decisions land, migrate `useABTests`, `useTemplates`, `useTemplateVersions` to `hooks/api/` + update `TemplateManagementDashboard.tsx` imports in the same commit.
5. **After all P2 complete:** `apps/client/lib/hooks/` folder deletes cleanly, closing the two-conventions footgun.

**No P1 deletions are safe in this audit's scope.** Prior P1 claim was wrong.

---

## 9. Coverage notes

- The 5 hooks (all classified `LEGACY_WORKING` or `LEGACY_WORKING_WITH_BROKEN_URLS` post-correction) were not functionally tested end-to-end by this audit — I verified URLs against backend and counted consumers but did not click through UI actions on `/dashboard/templates`. The 7 broken URLs in §6 P0 are a strong indicator that mutation actions fail, but whether the users see a graceful error UI or a crash depends on `TemplateManagementDashboard.tsx` error handling (unreviewed here).
- `useAutoSave.ts` uses `any` type on line 16 (`onSave?: (success: boolean, error?: any) => void;`) — out of scope for this audit but contradicts the project's zero-`any` rule.
- The `hooks.integration.test.ts` file has 5 `describe.todo` blocks (one per hook). All 5 are skipped tests and all 5 correspond to live hooks post-correction. None are orphaned. The remaining 2 hooks with broken URLs (`useABTests`, `useTemplateVersions`) could use real integration tests to catch the 404s; worth a future sprint.

---

## 10. Correction 2026-04-17 — audit methodology failure

**What went wrong:** the initial §1/§4/§5 of this document classified `useABTests`, `useTemplates`, `useTemplateVersions` as `DEAD_CODE` with "0 production consumers". That claim was wrong. They all have one consumer: `apps/client/app/dashboard/templates/TemplateManagementDashboard.tsx`, a routed page at `/dashboard/templates`.

**How it was caught:** sprint PRE-2 (2026-04-17) began the planned deletion of the 3 files. Its Phase 0.2 re-verification step — a mandatory re-grep before destructive action — returned the missed consumer. The hard-stop rule ("if any grep returns production consumers, stop and report") kicked in. No files were deleted.

**Root cause:** the initial consumer-search grep used `head_limit: 60`. The output was truncated before reaching `TemplateManagementDashboard.tsx`. Because the truncation was silent (no indicator that more matches existed below the cutoff), the audit misread the truncated output as "all matches seen, zero prod consumers found."

**Audit methodology change going forward:**

- Consumer-search greps use `head_limit: 0` (unlimited) or a value sized to the expected match count plus a comfortable margin. Never a small round number like 60.
- When any grep result ends at exactly the `head_limit`, treat it as possibly truncated and re-run with higher limit before drawing conclusions.
- Cross-reference the consumer search with a `grep -c` on the same pattern (count mode) to verify match count matches what content mode returned.

**Impact of this correction:**

- 0 files ready for deletion in this audit (was: 3, totaling 541 lines claimed).
- 5 files classified `LEGACY_WORKING` (was: 2). 3 of those have live broken URLs — a new P0 surfaces.
- `/dashboard/templates` page has silent 404s on user mutation actions — previously undocumented. Added to §6 P1 → P0.

**Commit:** [corrected via commit after approval of plan `omnipost-stryker-adaptive-hejlsberg.md` 2026-04-17]
