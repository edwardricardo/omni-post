# OmniPost Client — Feature Backlog

## Publishing Queue Monitor

**Priority:** P1
**Effort:** M
**Origin:** Removed from client in code-first audit (2026-04-10)
**Audit reference:** CODE_FIRST_AUDIT_REPORT.md — Section 4, Finding 1

### Context

The client app had a `/dashboard/queue` page that called admin-only BullMQ queue endpoints (`/admin/queue/*`). These endpoints are protected by `requireAdminAuth` and return 401/403 for customer users. The page was non-functional for actual clients and has been removed.

### What to Build

A customer-scoped publishing queue view showing only the current user's publishing jobs.

**New API endpoint needed:**

- `GET /api/publishing/jobs` — customer-scoped, returns only jobs belonging to the authenticated customer
- Filters by project if `?projectId=` provided
- Shows: status (waiting/active/failed/completed), platform, scheduledAt, post preview, error message if failed

**Frontend:**

- Page: `/dashboard/publishing/queue`
- Jobs grouped by status
- Failed jobs show user-friendly error reason
- Optional: "Retry" button via `POST /api/publishing/jobs/:id/retry` (customer-scoped)

**Not in scope (admin only):**

- Raw BullMQ stats (active workers, queue depth)
- Remove jobs
- View other customers' jobs

---

## Template & A/B Test — Missing Backend Routes

**Priority:** P1
**Effort:** M-L
**Origin:** Surfaced by the client-lib-hooks audit §6 P0 (2026-04-17; `CLIENT_LIB_HOOKS_AUDIT.md` borrado en la Pre-Fase, findings absorbidos en `MASTER_PLAN_ES.md` §5)
**Audit reference:** CLIENT_LIB_HOOKS_AUDIT.md §6 + ENDPOINT_AUDIT.md §5.1

### Context

The live page `/dashboard/templates` ([apps/client/app/dashboard/templates/TemplateManagementDashboard.tsx](../../apps/client/app/dashboard/templates/TemplateManagementDashboard.tsx)) uses 3 hooks from `apps/client/lib/hooks/` that invoke **URLs with no matching backend route**. Mutation buttons on that page silently fail with 404 today. See the audit §6 P0 table for the full list.

Per Edward's decision 2026-04-17: defer backend implementation to a future sprint rather than stub it now. This backlog entry tracks the required work.

### Backend routes to add (4)

#### A/B Tests — `apps/api/src/templates/templateRoutes.ts`

| Method   | Path                                                    | Handler to add                       |
| -------- | ------------------------------------------------------- | ------------------------------------ |
| `PUT`    | `/projects/:projectId/templates/ab-tests/:testId`       | `TemplateABTestHandler.updateABTest` |
| `POST`   | `/projects/:projectId/templates/ab-tests/:testId/pause` | `TemplateABTestHandler.pauseABTest`  |
| `DELETE` | `/projects/:projectId/templates/ab-tests/:testId`       | `TemplateABTestHandler.deleteABTest` |

Each requires a new method on `TemplateService` (currently has `getABTests`, `createABTest`, `startABTest`, `stopABTest`). The service should persist A/B test state — check if a Prisma `ABTest` model exists (per [Prisma client models](../../infra/prisma/generated/prisma/client/models/ABTest.ts) it does). Likely already scoped by `projectId + testId`.

#### Template Versions — same file

| Method   | Path                                                             | Handler to add                                 |
| -------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| `DELETE` | `/projects/:projectId/templates/:templateId/versions/:versionId` | `TemplateVersionHandler.deleteTemplateVersion` |

`TemplateService` currently has `getTemplateVersions`, `createTemplateVersion`, `restoreTemplateVersion`. Add delete.

### Client URL fixes to coordinate (7 total)

The 3 hooks in `apps/client/lib/hooks/` also call **existing** backend routes with wrong paths (missing `/projects/:id/` scope). These fixes are independent of the backend additions above and could ship separately:

| Hook                        | Current URL                         | Target URL                                                                  | Backend route (already exists) |
| --------------------------- | ----------------------------------- | --------------------------------------------------------------------------- | ------------------------------ |
| `useABTests.ts:83`          | `PUT /api/ab-tests/:id`             | `PUT /api/projects/:projectId/templates/ab-tests/:testId`                   | needs backend (above)          |
| `useABTests.ts:135`         | `DELETE /api/ab-tests/:id`          | `DELETE /api/projects/:projectId/templates/ab-tests/:testId`                | needs backend (above)          |
| `useTemplates.ts:71`        | `PUT /api/templates/:id`            | `PUT /api/projects/:projectId/templates/:templateId`                        | ✅ `templateRoutes.ts:61`      |
| `useTemplates.ts:87`        | `DELETE /api/templates/:id`         | `DELETE /api/projects/:projectId/templates/:templateId`                     | ✅ `templateRoutes.ts:70`      |
| `useTemplates.ts:97`        | `POST /api/templates/:id/duplicate` | `POST /api/projects/:projectId/templates/:templateId/duplicate`             | ✅ `templateRoutes.ts:81`      |
| `useTemplateVersions.ts:74` | `DELETE /api/template-versions/:id` | `DELETE /api/projects/:projectId/templates/:templateId/versions/:versionId` | needs backend (above)          |

Changes to these hooks also require updating the `*Api` method signatures to accept `projectId` (currently missing), which are all passed via closure from the hook's top-level `projectId` param.

### Recommended sequencing

1. **P1a (small, independent):** fix the 3 `useTemplates.ts` URLs — backend routes already exist. Immediate UX win on `/dashboard/templates` for update/delete/duplicate template actions.
2. **P1b (backend work):** implement the 4 missing backend routes + service methods + repository persistence.
3. **P1c (client URL fixes, depends on P1b):** fix `useABTests.ts` and `useTemplateVersions.ts` URLs.
4. **P2 (follow-up):** migrate the 3 hooks from `apps/client/lib/hooks/` to `apps/client/hooks/api/` + switch to `/api/backend/*` proxied URLs. Tracked separately in CLIENT_LIB_HOOKS_AUDIT.md §6 P2.

### Not in scope

- The rest of `apps/client/lib/hooks/` migration (useProviders, useAutoSave) — see CLIENT_LIB_HOOKS_AUDIT.md §6 P2.
- The naming clash between 3 `useProviders` implementations — separate audit.
