# Proposal: ScheduledReport + Campaign Tenant Guard (Slice 2)

## Intent

Slice 2 of the `project-scoped-tenant-guard` rollout. Two `projectId`-only, HIGH-importance
models — `ScheduledReport` and `Campaign` — are enrolled in NEITHER isolation layer, exposing
LIVE cross-tenant IDOR (CWE-639). Both are zero-wrap (no out-of-context callers), mechanically
identical to the Slice 1 reference recipe. Close both by extending `multi-tenant-isolation`.

## Verification (all claims checked at source)

| Claim                                                                                    | Verdict                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ScheduledReport: 6 id-only routes, no ownership check; absent from guard+RLS             | CONFIRMED (`reportRoutes.ts`; get resolves `findById` → `toJSON()`)                                                                                                                                                        |
| ScheduledReport escalation: update `recipients` → generate → analytics exfil to attacker | CONFIRMED (`UpdateScheduledReportUseCase` id-only; `GenerateReportUseCase` emails `report.recipients`)                                                                                                                     |
| ScheduledReport: `findDueReports` sweep has ZERO callers; zero out-of-context callers    | CONFIRMED (no worker/seed/script touches the model)                                                                                                                                                                        |
| Campaign: read+write IDOR on get/patch/archive/tag/untag; list trusts client `projectId` | CONFIRMED (`campaignRoutes.ts` all id-only; absent from both layers)                                                                                                                                                       |
| Campaign: `campaign.delete()` dead (0 use-case callers)                                  | CONFIRMED (repo `delete()` exists, no use case calls it — no live DELETE route)                                                                                                                                            |
| Campaign: 8 routes behind `requireClientAuth`, zero out-of-context callers               | CONFIRMED                                                                                                                                                                                                                  |
| **Create-path** ownership check (obs 273) — classification's "no caller fix"             | **REFUTED for BOTH.** `CreateScheduledReportUseCase` and `CreateCampaignUseCase` take client `projectId`, validate only UUID shape → foreign-parent write persists inconsistent row. Same gap Slice 1 found. Fix IN SCOPE. |

## Scope

### In Scope

- Enroll `ScheduledReport` + `Campaign`: `accountId` denormalization (nullable→backfill from `Project` over `projectId` FK→assert 0 NULL→NOT NULL→FK Cascade→accountId-led index), `TENANT_SCOPED_MODELS` append (51→53), forward RLS migration per model (+`down.sql`), explicit `accountId` threading.
- Create-path parent-ownership assertion per model → NOT_FOUND (404, never 403), incl. 404-not-500 conformance (route + use-case catch).
- Two-tenant real-DB integration test per model; `docs/security/MULTI_TENANT_GUARDS.md` update.

### Out of Scope

- The other 5 rollout models (their slices); N-SEC-4.
- `campaignPost` join table (not `projectId`-only; gated transitively via guarded `Campaign` lookup).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `multi-tenant-isolation`: append both models to Requirement-1 "Enrolled models" + Requirement-3 "Applied so far" tables; add two model-scoped Requirement-2-shaped blocks (ScheduledReport analytics-exfil closure; Campaign read+write closure).

## Approach

ONE change for both models (recommended): both zero-wrap, same `project` relation, identical
recipe — a shared branch/spec/test harness avoids ×2 migration-ordering coordination. Per model:
apply the Slice-1 recipe verbatim + the create-path assertion. Two column migrations + two RLS
migrations (grouping optional), all with timestamps **strictly greater than `20260714020135`**
(Slice 1's RLS migration), each column-migration before its RLS-migration in lexicographic order.

## Affected Areas

| Area                                          | Impact   | Description                                            |
| --------------------------------------------- | -------- | ------------------------------------------------------ |
| `infra/prisma/schema.prisma`                  | Modified | `accountId` on both models + indexes                   |
| `infra/prisma/migrations/**`                  | New      | 4 migrations (+down.sql) — SENSITIVE                   |
| `infra/prisma/src/extensions/tenantGuard.ts`  | Modified | append 2 model names — SENSITIVE                       |
| `packages/core/{reports,campaigns}/src/**`    | Modified | explicit `accountId` threading + create-path ownership |
| `apps/api/src/{reports,campaigns}/*Routes.ts` | Modified | NOT_FOUND→404 create branch                            |
| `apps/api/tests/integration/**`               | New      | two-tenant test per model                              |

## Risks

| Risk                                                | Likelihood | Mitigation                                                             |
| --------------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| Migration ordering collides with Slice-1 timestamps | Med        | Assert new timestamps > `20260714020135`; column-before-RLS            |
| Create foreign-parent 500s not 404 (Slice-1 trap)   | Med        | Return NOT_FOUND before doWork + route 404 branch + test asserts 404   |
| Hidden out-of-context caller breaks post-flip       | Low        | Verified zero at source; static no-caller scenario re-checked at apply |
| Backfill NULL/orphan                                | Low        | In-tx RAISE EXCEPTION on NULL before SET NOT NULL                      |

## Rollback

Revert branch (no merge to main until green). Post-merge: down-migrations drop RLS policies then
`accountId` columns; remove both names from `TENANT_SCOPED_MODELS`. No data loss (additive column).

## Dependencies

- Stacked on Slice-1 branch (`ExternalNotificationConfig` enrolled, guard=51, living spec present).
- `infra/prisma/**` + `tenantGuard.ts` require `omnipost-allow sensitive-edit` token at APPLY.

## Success Criteria

- [ ] Both models: three legs present (accountId+index, `TENANT_SCOPED_MODELS`, RLS) — static.
- [ ] Cross-tenant read/list/delete/update/generate resolve to empty/404; no analytics/data crosses — integration.
- [ ] Foreign-`projectId` create → 404 (never 403/500); own-parent create consistent — integration.
- [ ] Zero NULL `accountId`; row count preserved — integration.
- [ ] 0-defect gate green (tsc, eslint, fitness #21/#23, full regression).
