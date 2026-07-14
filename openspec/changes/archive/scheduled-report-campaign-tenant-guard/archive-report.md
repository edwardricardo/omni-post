# Archive Report — scheduled-report-campaign-tenant-guard

> Closure record for the `scheduled-report-campaign-tenant-guard` SDD change
> (Slice 2 of the `project-scoped-tenant-guard` rollout).
> Archived 2026-07-14. Store: hybrid (openspec files + engram mirror).

## Outcome

`ScheduledReport` and `Campaign` are now isolated by construction under the
two-layer tenant guard (Prisma `$extends` + PostgreSQL RLS), closing TWO LIVE
IDOR chains (CWE-639):

- `ScheduledReport`: six id-only routes (get/update/delete/generate/create/list)
  had no ownership check. The most severe escalation — rewrite `recipients` on a
  foreign report, then trigger `generate` to have that tenant's analytics emailed
  to an attacker-controlled address — is closed: both the update and the generate
  now resolve to NOT_FOUND before any analytics is computed or any email is sent.
- `Campaign`: eight id-only routes (get/patch/archive/tag/untag/analytics/create/list)
  had no ownership check. Enrollment alone closed most of them by construction
  (they resolve the model via a guarded `findById` before mutating), but the
  **untag** route bypassed the guard entirely — it mutates the `campaignPost` JOIN
  table directly with no parent `Campaign` lookup, a SECOND systematic gap class
  beyond the create-path one Slice 1 found. Closed via an explicit guarded
  `campaignRepository.findById(campaignId)` at the top of
  `UntagPostFromCampaignUseCase.execute` (D5).

Both models' create paths also carried the Slice-1-shaped gap: client-supplied
`projectId` was validated only for UUID shape, never ownership, letting a tenant
persist a row with its OWN `accountId` and a FOREIGN parent. Closed by injecting
`ProjectRepositoryPort` into both create use cases and returning NOT_FOUND (404,
never 403/500) before the transactional write (D3).

Full SDD cycle: proposal → spec → design → tasks → apply → verify → archive, on
branch `workstream/cluster-c-schedreport-campaign-guard`, stacked on the Slice 1
branch.

- **Apply**: the original apply agent's session died before checkboxes were
  marked; a subsequent verify pass independently re-ran every gate item from
  source (not trusted from any unverified claim) and confirmed the underlying
  work was in fact complete, then reconciled the stale checkboxes with proof.
- **Verify**: independent `sdd-verify` **PASS — 0 CRITICAL / 0 WARNING / 1
  SUGGESTION** (full detail: `verify-report.md` in this folder; engram mirror
  `sdd/scheduled-report-campaign-tenant-guard/verify-report`, observation #290).
- **Adversarial gate**: 4-lens + 2-refuter gate on the diff found **0 CRITICAL**
  in production code. It surfaced 1 WARNING (Campaign analytics route traverses
  the unguarded `campaignPost` join with no cross-tenant test coverage) and 2
  SUGGESTIONS (both suites had regressed to a tautological NULL check instead of
  the reference's per-row `accountId === project.accountId` invariant; the
  `emailSends` exfil sentinel had no positive control) — all three TEST-ONLY,
  zero production-code change. Fixed and re-verified: campaign suite 13/13,
  report suite 11/11, 0 cancelled in either; `eslint --max-warnings 0` clean;
  tsc 0 errors including both test files.
- **CI**: PR #114 (draft, stacked on #113) green on commit `872c41d9` — 5/5
  workflows passing, including the previously-chronic Integration Tests
  workflow.

## Delivered scope

- **Schema + migrations** (four, load-bearing order, all timestamps strictly
  greater than Slice 1's `20260714020135`): `add_scheduled_report_account_id` →
  `add_rls_scheduled_report` (+`down.sql`) → `add_campaign_account_id` →
  `add_rls_campaign` (+`down.sql`). Each column migration copies Slice 1's Recipe
  A verbatim (nullable `accountId` → backfill from `Project` over the NOT-NULL
  `projectId` FK → in-tx `RAISE EXCEPTION` on any NULL → `SET NOT NULL` → FK to
  `Account` `ON DELETE CASCADE` → accountId-led index); each RLS migration copies
  Recipe B verbatim (new forward `tenant_isolation` policy with `__system__`
  bypass, `20260527000000` never edited in place).
- **Guard flip**: `"campaign"` and `"scheduledReport"` appended alphabetically to
  `TENANT_SCOPED_MODELS` in `infra/prisma/src/extensions/tenantGuard.ts` (header
  count 51 → 53).
- **accountId threading (D2)**: `ScheduledReportProps`/`CampaignProps` gain a
  required `accountId: string` (entity-carried, plain string — the sibling
  convention for rich domain entities, vs. Slice 1's flat data-record threading);
  both adapters' row interface, `toDomain`, and upsert `create` branch carry it.
  `toDto`/`toJSON` never expose it.
- **Create-path ownership + 404 conformance (D3)**: `CreateScheduledReportUseCase`
  and `CreateCampaignUseCase` each gained a `ProjectRepositoryPort` 2nd
  constructor param; foreign/missing project resolves to
  `err(USE_CASE_ERRORS.NOT_FOUND)` BEFORE `doWork`, so the catch-all never
  flattens it to `INTERNAL_ERROR`. Unlike Slice 1, both create routes already
  mapped `NOT_FOUND → 404` — no route file changes were needed.
- **Untag join-table IDOR closure (D5, second systematic gap class)**:
  `UntagPostFromCampaignUseCase.execute` gained a guarded
  `campaignRepository.findById(campaignId)` at the top (mirroring
  `TagPostWithCampaignUseCase.ts:51`) — a foreign/missing campaign now resolves
  to NOT_FOUND before `removePost` runs, so B's `campaignPost` join row survives
  untouched instead of being deleted or 500ing on a P2025.
- **DI**: `setupAnalyticsUseCases.ts` and `setupCrisisUseCases.ts` inject
  `TOKENS.ProjectRepository` into the two create use cases.
- **Tests**: unit suites for both creates (6/6 + 6/6) and the new
  `UntagPostFromCampaignUseCase.test.ts` (4/4); guard unit test asserting
  `TENANT_SCOPED_MODELS` size 53 (29/29 overall); full regression sweep
  (`entities.campaign.test` 20/20, `campaignUseCases.test` 8/8,
  `reportUseCases.test` 17/17); the two MERGE-BLOCKING two-tenant real-DB
  integration suites —
  `apps/api/tests/integration/scheduledReportTenantIsolation.test.ts` (9/9) and
  `apps/api/tests/integration/campaignTenantIsolation.test.ts` (10/10 at verify,
  13/13 after adversarial-gate hardening), 0 cancelled in either.
- **Docs**: `docs/security/MULTI_TENANT_GUARDS.md` — both models promoted to
  tenant-scoped; model count updated.
- **0-defect gate**: `tsc --noEmit` = 0 across `@apps/api`, `@core/campaigns`,
  `@core/reports`, `@core/domain`; `eslint --max-warnings 0` = 0 on all 19
  changed/new files; fitness #21 (no Prisma singleton outside composition roots)
  = 0; fitness #23 (no raw queries outside guard exceptions) = 0; `prisma migrate
status` = 54 migrations, schema up to date, clean.

## Capabilities / specs applied

- `multi-tenant-isolation` → `openspec/specs/multi-tenant-isolation/spec.md`
  (living capability, EXTENDED — not created). This archive phase:
  - Confirmed the Requirement 1 "Enrolled models" table and Requirement 3
    "Applied so far" table already carried both models' rows (appended during
    apply).
  - Added the two model-scoped Requirement-2-shaped IDOR-closure blocks —
    `ScheduledReport — the live IDOR routes are closed, and no analytics
exfiltrates across the tenant boundary` and `Campaign — the live IDOR
routes are closed` — copied from the delta spec's ADDED Requirements,
    positioned after Slice 1's `ExternalNotificationConfig` block per the
    living spec's model-scoped-by-design extension contract. The Campaign
    block also gained a scenario for the analytics join-table traversal
    (closed by the pre-existing guarded existence check, now covered by a
    cross-tenant test per the adversarial-gate WARNING fix) and an explicit
    call-out that the untag route required an app-level guarded parent lookup
    beyond guard enrollment.
  - Extended the living spec's header with an "Extended by Slice 2" paragraph
    recording the join/child-table gap class as a durable, self-contained rule
    for Slices 3–8's MERGE-BLOCKING suites (see next section).

## Recipe additions for Slices 3–8 (from obs 285, the adversarial-gate discovery)

Beyond the Slice-1 reference recipe (7 points, recorded in the Slice-1 archive
report), Slice 2 adds two generalizations, now embedded directly in the living
spec's header extension contract:

1. **The join/child-table gap class covers WRITE mutations AND READ
   traversals, not just writes.** Guard enrollment closes routes that QUERY the
   enrolled model directly. It does NOT close a route that mutates OR reads a
   RELATED / JOIN / CHILD table (e.g. `campaignPost`) without first resolving
   the parent through a guarded `findById`. Slice 2 found this class twice: the
   untag route (a WRITE bypass, D5, closed with a code change) and the
   analytics route (a READ traversal, closed already by an existing guarded
   existence check, but uncovered by any cross-tenant test until the
   adversarial gate caught it). Every future slice MUST audit both write AND
   read routes for join/child-table traversal or a bypassed parent lookup.
2. **All-routes coverage is mandatory in the MERGE-BLOCKING suite** — not a
   representative subset. The analytics-route WARNING existed specifically
   because the suite covered 7 of Campaign's 8 routes; the 8th (analytics) was
   closed in code but unenforced by any test, meaning a future refactor could
   silently reopen it with nothing failing. Every future slice's suite must
   enumerate ALL of its model's routes explicitly and assert each one.
3. **Reference invariants must be copied completely, not abbreviated.** Both
   Slice-2 suites initially regressed to a tautological `accountId IS NULL`
   check (always true post-`SET NOT NULL`) instead of the Slice-1 reference's
   real invariant — per-row `accountId === project.accountId` — and lacked a
   positive control proving each exfiltration sentinel (e.g. `emailSends`)
   actually fires on the happy path. Every future slice's suite must copy the
   reference's full invariant set: per-row parent-consistency AND a positive
   control per sentinel, not just the negative/NULL checks.

## Residual (on the record, non-blocking)

Carried from Slice 1 (SUGGESTION S1, unchanged status): the per-slice
integration test remains the ONLY enforcement of `accountId ==
<parent>.accountId` on write paths; no static/fitness guard exists yet. Still a
backlog candidate for Slices 3–8 if drift appears, not introduced or worsened by
this change.

New from this slice (non-blocking, deliberate): `CreateCampaignUseCase` and
`CreateScheduledReportUseCase` build their `NOT_FOUND` error with 2 args (no
cause chain) while `UntagPostFromCampaignUseCase` passes a 3rd cause arg — a
deliberate anti-enumeration choice (avoid leaking the underlying error), flagged
as a minor stylistic inconsistency only, no follow-up required.

## Task completion

All 28 checkboxes across 7 phases in `tasks.md` are `[x]`. Stale-checkbox
reconciliation WAS needed at verify time — the original apply agent's session
died before marking them; `sdd-verify` independently re-ran every gate item and
both integration suites from source, confirmed the work was complete, and
reconciled the checkboxes with that proof (recorded in `verify-report.md`).

## Verification status

`sdd-verify` PASS — **0 CRITICAL / 0 WARNING / 1 SUGGESTION** (see
`verify-report.md`). A subsequent adversarial gate found 0 CRITICAL in
production code and 3 test-only findings (1 WARNING, 2 SUGGESTIONS), all fixed
and re-verified (campaign suite 13/13, report suite 11/11, 0 cancelled).

## Merge reference

- PR: **#114** (draft, stacked on #113)
- CI: green on commit `872c41d9` — 5/5 workflows, including the previously
  chronic Integration Tests workflow
- Branch: `workstream/cluster-c-schedreport-campaign-guard`
- Date archived: **2026-07-14**

## Rollout continuation

This is **Slice 2 of 9** in the `project-scoped-tenant-guard` rollout (Slice 1:
`external-notification-tenant-guard`, PR #113, archived). Next: **Slice 3**,
copying the reference recipe (Slice 1, 7 points) plus this slice's two
generalizations (join/child-table gap class covers reads too; all-routes
coverage; full reference-invariant copy) — both now embedded in the living
spec's header extension contract for direct visibility.

## Traceability — Engram observations

| Artifact                               | Topic key                                                   | Observation           |
| -------------------------------------- | ----------------------------------------------------------- | --------------------- |
| Proposal                               | `sdd/scheduled-report-campaign-tenant-guard/proposal`       | #282                  |
| Spec (delta)                           | `sdd/scheduled-report-campaign-tenant-guard/spec`           | #283                  |
| Design                                 | `sdd/scheduled-report-campaign-tenant-guard/design`         | #284                  |
| Join/child-table gap class (discovery) | `security/join-table-bypass-guard-gap`                      | #285                  |
| Tasks                                  | `sdd/scheduled-report-campaign-tenant-guard/tasks`          | #286                  |
| Apply progress                         | `sdd/scheduled-report-campaign-tenant-guard/apply-progress` | #288                  |
| Verify report                          | `sdd/scheduled-report-campaign-tenant-guard/verify-report`  | #290                  |
| Archive report (this document)         | `sdd/scheduled-report-campaign-tenant-guard/archive-report` | (saved by this phase) |
